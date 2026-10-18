import { Command } from '@commander-js/extra-typings';
import { emit, globalOptsOf, withSpinnerCall } from '../lib/actions';
import { requireClient } from '../lib/api';
import { getCredentialsPath } from '../lib/config';
import { buildHelpText } from '../lib/help-text';
import { fetchMe } from '../lib/resolve';

export const whoamiCommand = new Command('whoami')
  .description('Show who the current credentials belong to')
  .addHelpText(
    'after',
    buildHelpText({
      context:
        'Resolves the credential (--api-key, then THIRTYSEVENAUDITS_API_KEY, then the credentials file) and asks the API who it is.',
      output: `  {"authenticated":true,"authKind":"user","source":"config","userId":"<uuid>","email":"you@example.com","configPath":"<path>"}
  {"authenticated":true,"authKind":"api_key","source":"env","userId":"<uuid>","apiKey":{"id":"<uuid>","name":"CI","role":"admin","organizationId":"<uuid>","organizationName":"Acme"},"configPath":"<path>"}`,
      errorCodes: ['not_authenticated', 'auth_error'],
      examples: ['37audits whoami', '37audits whoami --json'],
    }),
  )
  .action(async (_opts, cmd) => {
    const globalOpts = globalOptsOf(cmd);
    const client = await requireClient(globalOpts);
    const me = await withSpinnerCall(
      globalOpts,
      'Checking credentials...',
      () => fetchMe(client),
    );
    const configPath = getCredentialsPath();

    emit(
      globalOpts,
      {
        authenticated: true,
        authKind:
          me?.authKind ?? (client.authKind === 'oauth' ? 'user' : 'api_key'),
        source: client.authSource,
        ...(me?.userId && { userId: me.userId }),
        ...(me?.email && { email: me.email }),
        ...(me?.apiKey && { apiKey: me.apiKey }),
        configPath,
      },
      (data) => {
        const lines = [
          `  Auth:    ${data.authKind === 'api_key' ? 'API key' : 'user session'} (from ${data.source})`,
        ];
        if (me?.apiKey) {
          lines.push(
            `  Key:     ${me.apiKey.name ?? me.apiKey.id} (${me.apiKey.role})`,
            `  Org:     ${me.apiKey.organizationName ?? me.apiKey.organizationId}`,
          );
        } else if (me?.email) {
          lines.push(`  Email:   ${me.email}`);
        }
        if (data.source === 'config') {
          lines.push(`  Config:  ${configPath}`);
        }
        console.log(['', ...lines, ''].join('\n'));
      },
    );
  });
