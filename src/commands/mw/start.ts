import { Command } from '@commander-js/extra-typings';
import { emit, fail, globalOptsOf, withSpinnerCall } from '../../lib/actions';
import { requireClient } from '../../lib/api';
import { parseDuration } from '../../lib/duration';
import { formatDate, summarizeStatuses } from '../../lib/format';
import { appendGithubOutput } from '../../lib/github-output';
import { buildHelpText } from '../../lib/help-text';
import { outputWarning } from '../../lib/output';
import { waitForGroup } from '../../lib/poll';
import { requireProjectTarget, resolveProjectId } from '../../lib/resolve';
import { createSpinner } from '../../lib/spinner';
import type { AuditorResult, MaintenanceWindow } from '../../lib/types';

const MAX_REASON_LENGTH = 500;

export const mwStartCommand = new Command('start')
  .description('Start a maintenance window now, optionally auditing first')
  .option('--project <uuid>', 'Project id')
  .option('--url-id <uuid>', 'A monitored URL id; its project is used')
  .option('--url <url>', 'A monitored URL address; its project is used')
  .option('--reason <text>', 'Why (e.g. the deploy); shown on the timeline')
  .option(
    '--run-auditors',
    'Run every auditor on the project first ("before" run)',
  )
  .option(
    '--ends-in <duration>',
    'Close the window automatically after e.g. 30m',
  )
  .option(
    '--ends-at <iso>',
    'Close the window automatically at this ISO-8601 time',
  )
  .option(
    '--wait',
    'With --run-auditors: poll until the before-run has finished',
  )
  .option('--timeout <duration>', 'How long --wait polls', '120s')
  .option('--interval <duration>', 'Polling interval', '5s')
  .addHelpText(
    'after',
    buildHelpText({
      context: `Needs an organization admin (an admin-role API key in CI). While the window is active,
scheduled audits are paused; manual runs are badged. Give it an end (--ends-in / --ends-at) so a
crashed pipeline cannot leave monitoring paused: the API ends it and runs the "after" audit.
In GitHub Actions the window id is written to $GITHUB_OUTPUT as window_id for a later
\`37audits mw end\` step. A --wait timeout is a warning: the window stays open, which is what a
deploy needs.`,
      output: `  {"id":"...","projectId":"...","status":"active","reason":"...","startsAt":"...","endsAt":"...","runs":[{"monitoredUrlId":"...","groupId":"..."}], "wait":{"results":63,"pending":0,"timedOut":false}}`,
      errorCodes: [
        'missing_target',
        'window_conflict',
        'forbidden',
        'invalid_duration',
        'invalid_options',
        'url_not_found',
      ],
      examples: [
        '37audits mw start --project 2b7e... --reason "Deploy of api at main@8c811f7" --run-auditors --wait --ends-in 30m',
        '37audits mw start --url https://www.example.com --reason "DB migration"',
      ],
    }),
  )
  .action(async (opts, cmd) => {
    const globalOpts = globalOptsOf(cmd);
    requireProjectTarget(opts, globalOpts);
    if (opts.endsIn && opts.endsAt) {
      fail(
        globalOpts,
        'Pass either --ends-in or --ends-at, not both.',
        'invalid_options',
      );
    }
    if (opts.wait && !opts.runAuditors) {
      fail(
        globalOpts,
        '--wait only makes sense with --run-auditors.',
        'invalid_options',
      );
    }
    if (opts.reason && opts.reason.length > MAX_REASON_LENGTH) {
      fail(
        globalOpts,
        `--reason is limited to ${MAX_REASON_LENGTH} characters.`,
        'invalid_options',
      );
    }

    let endsAt: string | undefined;
    let timeoutMs = 0;
    let intervalMs = 0;
    try {
      if (opts.endsIn) {
        endsAt = new Date(
          Date.now() + parseDuration(opts.endsIn),
        ).toISOString();
      }
      timeoutMs = parseDuration(opts.timeout);
      intervalMs = parseDuration(opts.interval);
    } catch (err) {
      fail(globalOpts, (err as Error).message, 'invalid_duration');
    }
    if (opts.endsAt) {
      const parsed = new Date(opts.endsAt);
      if (Number.isNaN(parsed.getTime())) {
        fail(
          globalOpts,
          `--ends-at "${opts.endsAt}" is not an ISO-8601 time.`,
          'invalid_duration',
        );
      }
      endsAt = parsed.toISOString();
    }

    const client = await requireClient(globalOpts);
    const projectId = await withSpinnerCall(
      globalOpts,
      'Resolving project...',
      () => resolveProjectId(client, opts),
    );

    const window = await withSpinnerCall(
      globalOpts,
      opts.runAuditors
        ? 'Starting maintenance window and the before-run...'
        : 'Starting maintenance window...',
      async () => {
        try {
          return await client.request<MaintenanceWindow>(
            'POST',
            `/v2/projects/${projectId}/maintenance-windows/start`,
            {
              body: {
                runAuditors: Boolean(opts.runAuditors),
                ...(endsAt && { endsAt }),
                ...(opts.reason && { reason: opts.reason }),
              },
            },
          );
        } catch (err) {
          if ((err as { statusCode?: number }).statusCode === 409) {
            fail(
              globalOpts,
              `Could not start: ${(err as Error).message} (another window is active or overlaps).`,
              'window_conflict',
            );
          }
          throw err;
        }
      },
      'start_error',
    );
    appendGithubOutput('window_id', window.id);

    const describeWindow = () =>
      `Maintenance window ${window.id} started (${window.endsAt ? `ends ${formatDate(window.endsAt)}` : 'open-ended'})`;

    if (!opts.wait) {
      emit(globalOpts, window, () => {
        const runs = window.runs?.length ?? 0;
        console.log(
          `${describeWindow()}${runs ? `; before-run started on ${runs} URL${runs === 1 ? '' : 's'}` : ''}.`,
        );
      });
      return;
    }

    const runs = window.runs ?? [];
    const deadline = Date.now() + timeoutMs;
    const spinner = createSpinner(
      'Waiting for the before-run...',
      globalOpts.quiet,
    );
    const results: AuditorResult[] = [];
    let pending = 0;
    let timedOut = false;
    for (const [index, run] of runs.entries()) {
      const outcome = await waitForGroup(client, {
        urlId: run.monitoredUrlId,
        groupId: run.groupId,
        deadline,
        intervalMs,
        onTick: (p, total, secondsLeft) =>
          spinner.update(
            `URL ${index + 1}/${runs.length}: ${p}/${total || '?'} auditors pending, ${secondsLeft}s left...`,
          ),
        onError: (message) =>
          spinner.update(`Poll failed, retrying: ${message}`),
      });
      results.push(...outcome.results);
      pending += outcome.pending;
      timedOut = timedOut || outcome.timedOut;
    }
    spinner.stop();

    if (timedOut) {
      outputWarning(
        `Timed out after ${opts.timeout} with ${pending} auditor result(s) still pending; the window is active and the results will still land.`,
        { json: globalOpts.json },
      );
    }

    emit(
      globalOpts,
      { ...window, wait: { results: results.length, pending, timedOut } },
      () => {
        console.log(
          `${describeWindow()}; before-run: ${results.length ? summarizeStatuses(results) : 'no auditors ran'}.`,
        );
      },
    );
  });
