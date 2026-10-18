import { Command } from '@commander-js/extra-typings';
import { emit, fail, globalOptsOf, withSpinnerCall } from '../../lib/actions';
import { requireClient } from '../../lib/api';
import { parseDuration } from '../../lib/duration';
import { countGated, FAIL_ON_EXIT_CODE, parseFailOn } from '../../lib/fail-on';
import { resultsTable, summarizeStatuses } from '../../lib/format';
import { appendGithubOutput } from '../../lib/github-output';
import { buildHelpText } from '../../lib/help-text';
import { outputWarning } from '../../lib/output';
import { waitForGroup } from '../../lib/poll';
import { requireTarget, resolveMonitoredUrl } from '../../lib/resolve';
import { createSpinner } from '../../lib/spinner';
import type { AuditRunResult } from '../../lib/types';

export const auditRunCommand = new Command('run')
  .description('Start an audit run on a monitored URL')
  .option('--url-id <uuid>', 'Monitored URL id')
  .option('--url <url>', 'Monitored URL address (resolved to its id)')
  .option(
    '--auditor <id>',
    'Run only this auditor (repeatable); default: every enabled auditor',
    (value: string, previous: string[]) => [...previous, value],
    [] as string[],
  )
  .option('--note <text>', 'Note stored with the run (e.g. the deploy)')
  .option('--wait', 'Poll until every auditor has finished')
  .option(
    '--timeout <duration>',
    'How long --wait polls (e.g. 120s, 5m)',
    '120s',
  )
  .option('--interval <duration>', 'Polling interval', '5s')
  .option(
    '--fail-on <level>',
    'Exit 2 when a result is "fail" (fail|error) or "warning" (also warnings); implies --wait',
  )
  .addHelpText(
    'after',
    buildHelpText({
      context: `Starts the run (HTTP 202) and prints one entry per auditor. With --wait it polls the
run group until no result is pending; a timeout is a warning, not an error, unless
--fail-on is set. In GitHub Actions the group id is written to $GITHUB_OUTPUT as group_id.
Exit codes: 0 ok, 1 error, 2 a --fail-on gate tripped, 130 cancelled.`,
      output: `  without --wait: [{"id":"...","urlId":"...","auditor":{"id":"...","name":"..."},"status":"pending","groupId":"..."}]
  with --wait:    {"groupId":"...","results":[{"auditorId":"...","auditorName":"...","status":"success","message":"..."}],"pending":0,"timedOut":false}`,
      errorCodes: [
        'missing_target',
        'url_not_found',
        'insufficient_credits',
        'not_found',
        'conflict',
        'wait_timeout',
        'invalid_duration',
        'invalid_options',
      ],
      examples: [
        '37audits audit run --url https://www.example.com --wait',
        '37audits audit run --url-id 4f2c... --note "Deploy of app at main@8c811f7" --wait --timeout 3m',
        '37audits audit run --url https://www.example.com --fail-on fail',
      ],
    }),
  )
  .action(async (opts, cmd) => {
    const globalOpts = globalOptsOf(cmd);
    requireTarget(opts, globalOpts);

    let failOn: ReturnType<typeof parseFailOn> | undefined;
    let timeoutMs = 0;
    let intervalMs = 0;
    try {
      failOn = opts.failOn ? parseFailOn(opts.failOn) : undefined;
    } catch (err) {
      fail(globalOpts, (err as Error).message, 'invalid_options');
    }
    try {
      timeoutMs = parseDuration(opts.timeout);
      intervalMs = parseDuration(opts.interval);
    } catch (err) {
      fail(globalOpts, (err as Error).message, 'invalid_duration');
    }
    const wait = Boolean(opts.wait || failOn);

    const client = await requireClient(globalOpts);
    const target = await withSpinnerCall(
      globalOpts,
      'Resolving monitored URL...',
      () => resolveMonitoredUrl(client, opts),
    );

    const started = await withSpinnerCall(
      globalOpts,
      `Starting audit on ${target.url}...`,
      () =>
        client.request<AuditRunResult[]>(
          'POST',
          `/v2/monitored-urls/${target.id}/audit-results/run`,
          { query: { note: opts.note, auditorId: opts.auditor } },
        ),
      'run_error',
    );
    const groupId = started[0]?.groupId;
    if (!groupId) {
      fail(
        globalOpts,
        'The API started no auditors (nothing enabled on this URL?).',
        'run_error',
      );
    }
    appendGithubOutput('group_id', groupId);

    if (!wait) {
      emit(globalOpts, started, (results) => {
        console.log(
          `Started ${results.length} auditor${results.length === 1 ? '' : 's'} on ${target.url} (group ${groupId}).`,
        );
      });
      return;
    }

    const spinner = createSpinner('Waiting for auditors...', globalOpts.quiet);
    const outcome = await waitForGroup(client, {
      urlId: target.id,
      groupId,
      deadline: Date.now() + timeoutMs,
      intervalMs,
      onTick: (pending, total, secondsLeft) =>
        spinner.update(
          `${pending}/${total || started.length} auditors still pending, ${secondsLeft}s left...`,
        ),
      onError: (message) => spinner.update(`Poll failed, retrying: ${message}`),
    });
    spinner.stop();

    if (outcome.timedOut) {
      if (failOn) {
        fail(
          globalOpts,
          `Timed out after ${opts.timeout} with ${outcome.pending} auditor(s) still pending (group ${groupId}).`,
          'wait_timeout',
        );
      }
      outputWarning(
        `Timed out after ${opts.timeout} with ${outcome.pending} auditor(s) still pending; results will still land on 37audits.com.`,
        { json: globalOpts.json },
      );
    }

    emit(
      globalOpts,
      {
        groupId,
        results: outcome.results,
        pending: outcome.pending,
        timedOut: outcome.timedOut,
      },
      (data) => {
        console.log(resultsTable(data.results));
        console.log(`\n${summarizeStatuses(data.results)} on ${target.url}`);
      },
    );

    if (failOn) {
      const gated = countGated(outcome.results, failOn);
      if (gated > 0) {
        outputWarning(
          `${gated} result(s) at or above "${failOn}"; exiting with code ${FAIL_ON_EXIT_CODE}.`,
          { json: globalOpts.json },
        );
        process.exit(FAIL_ON_EXIT_CODE);
      }
    }
  });
