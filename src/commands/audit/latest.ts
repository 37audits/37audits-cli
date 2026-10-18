import { Command } from '@commander-js/extra-typings';
import { emit, fail, globalOptsOf, withSpinnerCall } from '../../lib/actions';
import { requireClient } from '../../lib/api';
import { countGated, FAIL_ON_EXIT_CODE, parseFailOn } from '../../lib/fail-on';
import { resultsTable, summarizeStatuses } from '../../lib/format';
import { buildHelpText } from '../../lib/help-text';
import { outputWarning } from '../../lib/output';
import { requireTarget, resolveMonitoredUrl } from '../../lib/resolve';
import type { AuditorResult } from '../../lib/types';

export const auditLatestCommand = new Command('latest')
  .description('Show the latest result of every auditor on a monitored URL')
  .option('--url-id <uuid>', 'Monitored URL id')
  .option('--url <url>', 'Monitored URL address (resolved to its id)')
  .option(
    '--fail-on <level>',
    'Exit 2 when a result is "fail" (fail|error) or "warning" (also warnings)',
  )
  .addHelpText(
    'after',
    buildHelpText({
      context: `One row per enabled auditor with its newest result. Pending results never trip --fail-on.
Exit codes: 0 ok, 1 error, 2 a --fail-on gate tripped.`,
      output: `  [{"id":"...","auditorId":"...","auditorName":"...","status":"success","message":"...","createdAt":"...","checks":[...]}]`,
      errorCodes: [
        'missing_target',
        'url_not_found',
        'not_found',
        'invalid_options',
      ],
      examples: [
        '37audits audit latest --url https://www.example.com',
        '37audits audit latest --url-id 4f2c... --fail-on warning',
      ],
    }),
  )
  .action(async (opts, cmd) => {
    const globalOpts = globalOptsOf(cmd);
    requireTarget(opts, globalOpts);
    let failOn: ReturnType<typeof parseFailOn> | undefined;
    try {
      failOn = opts.failOn ? parseFailOn(opts.failOn) : undefined;
    } catch (err) {
      fail(globalOpts, (err as Error).message, 'invalid_options');
    }

    const client = await requireClient(globalOpts);
    const target = await withSpinnerCall(
      globalOpts,
      'Resolving monitored URL...',
      () => resolveMonitoredUrl(client, opts),
    );
    const results = await withSpinnerCall(
      globalOpts,
      'Fetching latest results...',
      () =>
        client.request<AuditorResult[]>(
          'GET',
          `/v2/monitored-urls/${target.id}/audit-results/latest`,
        ),
      'fetch_error',
    );

    emit(globalOpts, results, (data) => {
      console.log(resultsTable(data));
      console.log(`\n${summarizeStatuses(data)} on ${target.url}`);
    });

    if (failOn) {
      const gated = countGated(results, failOn);
      if (gated > 0) {
        outputWarning(
          `${gated} result(s) at or above "${failOn}"; exiting with code ${FAIL_ON_EXIT_CODE}.`,
          { json: globalOpts.json },
        );
        process.exit(FAIL_ON_EXIT_CODE);
      }
    }
  });
