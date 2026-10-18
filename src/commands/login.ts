import { Command } from '@commander-js/extra-typings';
import pc from 'picocolors';
import { emit, fail, globalOptsOf, withSpinnerCall } from '../lib/actions';
import { ApiClient, type GlobalOpts } from '../lib/api';
import { openInBrowser } from '../lib/browser';
import { getCredentialsPath, storeCredential } from '../lib/config';
import { authUrl, ENV, oauthClientId } from '../lib/env';
import { buildHelpText } from '../lib/help-text';
import {
  buildAuthorizeUrl,
  createCallbackServer,
  credentialFromTokens,
  exchangeAuthorizationCode,
  generatePKCE,
  OAuthError,
} from '../lib/oauth';
import { errorMessage, outputError } from '../lib/output';
import { fetchMe } from '../lib/resolve';
import { createSpinner } from '../lib/spinner';
import { isInteractive } from '../lib/tty';
import type { Me, Organization } from '../lib/types';

async function identify(client: ApiClient): Promise<Me | null> {
  const me = await fetchMe(client);
  if (me) {
    return me;
  }
  // An API without /v2/me: any authenticated call proves the credential.
  await client.request<Organization[]>('GET', '/v2/organizations');
  return null;
}

function describe(me: Me | null): string {
  if (!me) {
    return '';
  }
  if (me.apiKey) {
    const org = me.apiKey.organizationName ?? me.apiKey.organizationId;
    return `API key "${me.apiKey.name ?? me.apiKey.id}" for ${org} (${me.apiKey.role})`;
  }
  return me.email ?? me.userId;
}

async function loginWithApiKey(
  key: string,
  globalOpts: GlobalOpts,
): Promise<void> {
  if (!key.startsWith('tsa_')) {
    fail(
      globalOpts,
      'Invalid API key format: 37 Audits keys start with tsa_live_ or tsa_test_.',
      'invalid_key_format',
    );
  }
  const client = new ApiClient({ type: 'api_key', key, source: 'flag' });
  const me = await withSpinnerCall(
    globalOpts,
    'Validating API key...',
    () => identify(client),
    'validation_failed',
  );
  const configPath = storeCredential({ type: 'api_key', api_key: key });
  emit(
    globalOpts,
    {
      success: true,
      authKind: 'api_key',
      ...(me?.apiKey && {
        organization: me.apiKey.organizationName ?? me.apiKey.organizationId,
        role: me.apiKey.role,
      }),
      configPath,
    },
    () => {
      const who = describe(me);
      console.log(`${who ? `${who} ` : 'API key '}saved to ${configPath}`);
    },
  );
}

async function loginWithBrowser(globalOpts: GlobalOpts): Promise<void> {
  const clientId = oauthClientId();
  if (!clientId) {
    fail(
      globalOpts,
      `Browser login is not configured in this build. Set ${ENV.oauthClientId} to the CLI's OAuth client id, or use --api-key.`,
      'oauth_not_configured',
    );
  }
  const server = authUrl();
  const { codeVerifier, codeChallenge, state } = generatePKCE();

  let callback: Awaited<ReturnType<typeof createCallbackServer>>;
  try {
    callback = await createCallbackServer();
  } catch (err) {
    return outputError(
      {
        message: errorMessage(err, 'Could not start the login callback server'),
        code: err instanceof OAuthError ? err.code : 'oauth_error',
      },
      { json: globalOpts.json },
    );
  }

  const url = buildAuthorizeUrl({
    authUrl: server,
    clientId,
    redirectUri: callback.redirectUri,
    state,
    codeChallenge,
  });

  const opened = await openInBrowser(url);
  if (!globalOpts.quiet) {
    console.error(
      opened
        ? `Opening your browser to sign in to 37 Audits. If nothing happens, open:\n  ${pc.blue(url)}`
        : `Open this link in your browser to sign in:\n  ${pc.blue(url)}`,
    );
  }

  const spinner = createSpinner('Waiting for the browser...', globalOpts.quiet);
  let code: string;
  try {
    const result = await callback.waitForCallback;
    if (result.state !== state) {
      throw new OAuthError(
        'The callback state does not match this login attempt. Run `37audits login` again.',
        'oauth_state_mismatch',
      );
    }
    code = result.code;
    spinner.stop('Browser sign-in complete');
  } catch (err) {
    spinner.fail('Sign-in failed');
    return outputError(
      {
        message: errorMessage(err, 'Sign-in failed'),
        code: err instanceof OAuthError ? err.code : 'oauth_error',
      },
      { json: globalOpts.json },
    );
  } finally {
    callback.close();
  }

  const tokens = await withSpinnerCall(
    globalOpts,
    'Exchanging the authorization code...',
    () =>
      exchangeAuthorizationCode({
        authUrl: server,
        clientId,
        code,
        redirectUri: callback.redirectUri,
        codeVerifier,
      }),
    'oauth_error',
  );
  const credential = credentialFromTokens(tokens, {
    authUrl: server,
    clientId,
  });
  const configPath = storeCredential(credential);

  let me: Me | null = null;
  try {
    me = await fetchMe(
      new ApiClient({ type: 'oauth', credential, source: 'config' }),
    );
  } catch {
    /* the greeting is best-effort; the login itself succeeded */
  }

  emit(
    globalOpts,
    {
      success: true,
      authKind: 'user',
      ...(me?.email && { email: me.email }),
      configPath,
    },
    () => {
      console.log(
        `Logged in${me?.email ? ` as ${me.email}` : ''}. Credentials saved to ${configPath}`,
      );
    },
  );
}

export const loginCommand = new Command('login')
  .description('Sign in through the browser, or save an API key for CI')
  .option('--api-key <key>', 'API key to store (tsa_live_... or tsa_test_...)')
  .addHelpText(
    'after',
    buildHelpText({
      context: `Interactive: opens the browser for an OAuth sign-in to your 37 Audits account.
Non-interactive (CI, piped, --json): pass --api-key; or skip login entirely and set ${ENV.apiKey}.
Credentials are stored with mode 0600 in ${getCredentialsPath()}.`,
      output: `  {"success":true,"authKind":"user","email":"you@example.com","configPath":"<path>"}
  {"success":true,"authKind":"api_key","organization":"Acme","role":"admin","configPath":"<path>"}`,
      errorCodes: [
        'missing_api_key',
        'invalid_key_format',
        'validation_failed',
        'oauth_not_configured',
        'oauth_port_unavailable',
        'oauth_timeout',
        'oauth_state_mismatch',
        'oauth_error',
      ],
      examples: [
        '37audits login',
        '37audits login --api-key tsa_live_...',
        `${ENV.apiKey}=tsa_live_... 37audits whoami   (no login needed)`,
      ],
    }),
  )
  .action(async (opts, cmd) => {
    const globalOpts = globalOptsOf(cmd);
    // The option exists on both `login` and the program; take whichever was
    // given (`login --api-key k` or `--api-key k login`).
    const key = (
      opts.apiKey ?? (cmd.parent?.opts() as GlobalOpts | undefined)?.apiKey
    )?.trim();

    if (key) {
      await loginWithApiKey(key, globalOpts);
      return;
    }
    if (!isInteractive() || globalOpts.json) {
      fail(
        globalOpts,
        `Browser sign-in needs an interactive terminal. In CI pass --api-key <key> or set ${ENV.apiKey}.`,
        'missing_api_key',
      );
    }
    await loginWithBrowser(globalOpts);
  });
