import { Command } from '@commander-js/extra-typings';
import { emit, globalOptsOf } from '../lib/actions';
import { removeCredentials } from '../lib/config';
import { buildHelpText } from '../lib/help-text';
import { errorMessage, outputError } from '../lib/output';

export const logoutCommand = new Command('logout')
  .description('Remove the stored credentials')
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Deletes the credentials file. Environment variables are not touched.',
      output: `  {"success":true,"removed":true,"configPath":"<path>"}`,
      errorCodes: ['remove_failed'],
      examples: ['37audits logout'],
    }),
  )
  .action((_opts, cmd) => {
    const globalOpts = globalOptsOf(cmd);
    let result: ReturnType<typeof removeCredentials>;
    try {
      result = removeCredentials();
    } catch (err) {
      return outputError(
        {
          message: errorMessage(err, 'Could not remove the credentials'),
          code: 'remove_failed',
        },
        { json: globalOpts.json },
      );
    }
    emit(
      globalOpts,
      { success: true, removed: result.removed, configPath: result.path },
      ({ removed, configPath }) => {
        console.log(
          removed ? `Logged out (removed ${configPath})` : 'Not logged in.',
        );
      },
    );
  });
