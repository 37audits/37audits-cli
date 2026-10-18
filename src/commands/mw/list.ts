import { Command } from '@commander-js/extra-typings';
import { emit, fail, globalOptsOf, withSpinnerCall } from '../../lib/actions';
import { requireClient } from '../../lib/api';
import { windowsTable } from '../../lib/format';
import { buildHelpText } from '../../lib/help-text';
import { requireProjectTarget, resolveProjectId } from '../../lib/resolve';
import type { MaintenanceWindow } from '../../lib/types';

const STATUSES = new Set(['scheduled', 'active', 'ended']);

export const mwListCommand = new Command('list')
  .description("List a project's maintenance windows, newest first")
  .option('--project <uuid>', 'Project id')
  .option('--url-id <uuid>', 'A monitored URL id; its project is used')
  .option('--url <url>', 'A monitored URL address; its project is used')
  .option('--status <status>', 'Only scheduled, active or ended windows')
  .option('--limit <n>', 'Maximum number of windows', '20')
  .addHelpText(
    'after',
    buildHelpText({
      output: `  [{"id":"...","projectId":"...","status":"ended","reason":"...","startsAt":"...","endsAt":"...","preRunAt":"...","postRunAt":"...","createdBy":{"displayName":"..."}}]`,
      errorCodes: [
        'missing_target',
        'invalid_options',
        'not_found',
        'url_not_found',
      ],
      examples: [
        '37audits mw list --project 2b7e...',
        '37audits mw list --url https://www.example.com --status active',
      ],
    }),
  )
  .action(async (opts, cmd) => {
    const globalOpts = globalOptsOf(cmd);
    requireProjectTarget(opts, globalOpts);
    if (opts.status && !STATUSES.has(opts.status)) {
      fail(
        globalOpts,
        `--status must be scheduled, active or ended (got "${opts.status}").`,
        'invalid_options',
      );
    }
    const limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      fail(
        globalOpts,
        `--limit must be a positive integer (got "${opts.limit}").`,
        'invalid_options',
      );
    }

    const client = await requireClient(globalOpts);
    const projectId = await withSpinnerCall(
      globalOpts,
      'Resolving project...',
      () => resolveProjectId(client, opts),
    );
    const windows = await withSpinnerCall(
      globalOpts,
      'Fetching maintenance windows...',
      () =>
        client.request<MaintenanceWindow[]>(
          'GET',
          `/v2/projects/${projectId}/maintenance-windows`,
        ),
      'list_error',
    );
    const filtered = windows
      .filter((w) => !opts.status || w.status === opts.status)
      .slice(0, limit);

    emit(globalOpts, filtered, (data) => {
      console.log(windowsTable(data));
    });
  });
