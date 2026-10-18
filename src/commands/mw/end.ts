import { Command } from '@commander-js/extra-typings';
import { emit, fail, globalOptsOf, withSpinnerCall } from '../../lib/actions';
import { requireClient } from '../../lib/api';
import { buildHelpText } from '../../lib/help-text';
import { requireProjectTarget, resolveProjectId } from '../../lib/resolve';
import type { MaintenanceWindow } from '../../lib/types';

export const mwEndCommand = new Command('end')
  .description('End the active maintenance window (runs the "after" audit)')
  .argument('[id]', "Window id; default: the project's active window")
  .option('--project <uuid>', 'Project id')
  .option('--url-id <uuid>', 'A monitored URL id; its project is used')
  .option('--url <url>', 'A monitored URL address; its project is used')
  .addHelpText(
    'after',
    buildHelpText({
      context: `Needs an organization admin. Ending a window runs every auditor on the project once more
("after" run) so the timeline shows a before/after pair. A window that already ended (for
example by its --ends-in cap) answers window_not_active.`,
      output: `  {"id":"...","status":"ended","endsAt":"...","runs":[{"monitoredUrlId":"...","groupId":"..."}]}`,
      errorCodes: [
        'missing_target',
        'no_active_window',
        'window_not_active',
        'not_found',
        'forbidden',
      ],
      examples: [
        '37audits mw end --project 2b7e...',
        '37audits mw end 9c1d... --project 2b7e...',
      ],
    }),
  )
  .action(async (idArg, opts, cmd) => {
    const globalOpts = globalOptsOf(cmd);
    requireProjectTarget(opts, globalOpts);

    const client = await requireClient(globalOpts);
    const projectId = await withSpinnerCall(
      globalOpts,
      'Resolving project...',
      () => resolveProjectId(client, opts),
    );
    const base = `/v2/projects/${projectId}/maintenance-windows`;

    let id = idArg;
    if (!id) {
      const windows = await withSpinnerCall(
        globalOpts,
        'Finding the active window...',
        () => client.request<MaintenanceWindow[]>('GET', base),
      );
      const active = windows.find((w) => w.status === 'active');
      if (!active) {
        fail(
          globalOpts,
          'This project has no active maintenance window.',
          'no_active_window',
        );
      }
      id = active.id;
    }

    const window = await withSpinnerCall(
      globalOpts,
      'Ending maintenance window...',
      async () => {
        try {
          return await client.request<MaintenanceWindow>(
            'POST',
            `${base}/${id}/end`,
          );
        } catch (err) {
          if ((err as { statusCode?: number }).statusCode === 409) {
            fail(
              globalOpts,
              `Window ${id} is not active: ${(err as Error).message}`,
              'window_not_active',
            );
          }
          throw err;
        }
      },
      'end_error',
    );

    emit(globalOpts, window, () => {
      const runs = window.runs?.length ?? 0;
      console.log(
        `Maintenance window ${window.id} ended${runs ? `; after-run started on ${runs} URL${runs === 1 ? '' : 's'}` : ''}.`,
      );
    });
  });
