#!/usr/bin/env node
import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import { auditCommand } from './commands/audit/index';
import { loginCommand } from './commands/login';
import { logoutCommand } from './commands/logout';
import { mwCommand } from './commands/mw/index';
import { whoamiCommand } from './commands/whoami';
import { setupCliExitHandler } from './lib/cli-exit';
import { ENV } from './lib/env';
import { errorMessage, outputError } from './lib/output';
import { PACKAGE_NAME, VERSION } from './lib/version';

setupCliExitHandler();

const program = new Command()
  .name('37audits')
  .description(
    '37 Audits CLI — run audits and manage maintenance windows from CI/CD',
  )
  .configureHelp({
    showGlobalOptions: true,
    styleTitle: (str) => pc.gray(str),
  })
  .configureOutput({
    writeErr: (str) => {
      process.stderr.write(str.replace(/^error:/, () => pc.red('error:')));
    },
  })
  .helpCommand(true)
  .version(
    `${PACKAGE_NAME} v${VERSION}`,
    '-v, --version',
    'Output the current version',
  )
  .option(
    '--api-key <key>',
    `API key (overrides ${ENV.apiKey} and the stored credentials)`,
  )
  .option('--json', 'Force JSON output (also on when stdout is not a TTY)')
  .option('-q, --quiet', 'Suppress spinners and status output (implies --json)')
  .hook('preAction', (thisCommand, actionCommand) => {
    if (actionCommand.optsWithGlobals().quiet) {
      thisCommand.setOptionValue('json', true);
    }
  })
  .addHelpText(
    'after',
    `
${pc.gray('Examples:')}

  ${pc.blue('$ 37audits login')}
  ${pc.blue('$ 37audits audit run --url https://www.example.com --wait')}
  ${pc.blue('$ 37audits mw start --project <uuid> --run-auditors --wait --ends-in 30m --reason "Deploy"')}
  ${pc.blue('$ 37audits mw end --project <uuid>')}

${pc.gray('Environment:')}

  ${ENV.apiKey}          API key for CI (no login needed)
  ${ENV.apiBaseUrl}     API base URL (default https://api.37audits.com)
`,
  )
  .addCommand(loginCommand)
  .addCommand(logoutCommand)
  .addCommand(whoamiCommand)
  .addCommand(auditCommand)
  .addCommand(mwCommand);

program.parseAsync().catch((err) => {
  outputError({
    message: errorMessage(err, 'An unexpected error occurred'),
    code: 'unexpected_error',
  });
});
