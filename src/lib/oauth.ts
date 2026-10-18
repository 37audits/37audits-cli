import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  getCredentialsLockPath,
  type OAuthCredential,
  readCredentials,
  writeCredentials,
} from './config';
import {
  CALLBACK_PATH,
  CALLBACK_PORTS,
  OAUTH_SCOPE,
  redirectUriFor,
} from './env';
import { withFileLock } from './file-lock';

export class OAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

const LOGIN_AGAIN = 'Run `37audits login` to sign in again.';
const TOKEN_REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_EXPIRY_LEEWAY_SECONDS = 60;
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

export function generatePKCE(): {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
} {
  const codeVerifier = randomBytes(64).toString('base64url');
  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  const state = randomBytes(24).toString('base64url');
  return { codeVerifier, codeChallenge, state };
}

export function getJwtExp(token: string): number {
  const invalid = new OAuthError(
    `Received an invalid access token. ${LOGIN_AGAIN}`,
    'oauth_error',
  );
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw invalid;
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    throw invalid;
  }
  const exp = (decoded as { exp?: unknown } | null)?.exp;
  if (typeof exp !== 'number') {
    throw invalid;
  }
  return exp;
}

/**
 * Supabase's /oauth/token answer: access_token, refresh_token, expires_in,
 * token_type and (with the openid scope) id_token. Verified 2026-10-18.
 */
export type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
  id_token?: string;
};

export function parseTokenResponse(json: unknown): TokenResponse {
  const data = json as Record<string, unknown> | null;
  if (
    typeof data !== 'object' ||
    data === null ||
    typeof data.access_token !== 'string' ||
    data.access_token.length === 0 ||
    typeof data.refresh_token !== 'string' ||
    data.refresh_token.length === 0
  ) {
    throw new OAuthError(
      `Unexpected response from the authorization server. ${LOGIN_AGAIN}`,
      'oauth_error',
    );
  }
  return data as TokenResponse;
}

export function buildAuthorizeUrl(params: {
  authUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const url = new URL(`${params.authUrl}/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPE,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

function callbackPage(heading: string, message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>37 Audits CLI</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0f19; color: #e5e7eb; padding: 16px; }
  main { max-width: 28rem; text-align: center; }
  h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
  p { margin: 0; color: #9ca3af; }
</style>
</head>
<body><main><h1>${heading}</h1><p>${message}</p></main></body>
</html>`;
}

export interface CallbackServer {
  port: number;
  redirectUri: string;
  waitForCallback: Promise<{ code: string; state: string }>;
  close(): void;
}

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

/**
 * Starts the loopback server on the first free registered port. Redirect URIs
 * must match the registration exactly, so the ports are fixed rather than
 * random.
 */
export async function createCallbackServer(
  ports: readonly number[] = CALLBACK_PORTS,
): Promise<CallbackServer> {
  let server: Server | undefined;
  let port = 0;
  for (const candidate of ports) {
    try {
      server = await listenOn(candidate);
      port = candidate;
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        throw new OAuthError(
          `Could not start the login callback server on 127.0.0.1:${candidate}: ${(err as Error).message}`,
          'oauth_error',
        );
      }
    }
  }
  if (!server) {
    throw new OAuthError(
      `Ports ${ports.join(', ')} on 127.0.0.1 are all in use. Free one of them and run \`37audits login\` again.`,
      'oauth_port_unavailable',
    );
  }

  const listening = server;
  let resolveCallback!: (v: { code: string; state: string }) => void;
  let rejectCallback!: (e: Error) => void;
  const waitForCallback = new Promise<{ code: string; state: string }>(
    (resolve, reject) => {
      resolveCallback = resolve;
      rejectCallback = reject;
    },
  );

  const timeout = setTimeout(() => {
    listening.close();
    rejectCallback(
      new OAuthError(
        'Timed out after 5 minutes waiting for the browser. Run `37audits login` again.',
        'oauth_timeout',
      ),
    );
  }, CALLBACK_TIMEOUT_MS);

  listening.on('request', (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== CALLBACK_PATH) {
      res.writeHead(404, { Connection: 'close' });
      res.end();
      return;
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const description = url.searchParams.get('error_description');

    const failure = error
      ? `Authorization ${error === 'access_denied' ? 'denied' : `failed: ${error}`}${description ? ` (${description})` : ''}`
      : !code || !state
        ? 'The callback is missing the code or state parameter'
        : null;

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      Connection: 'close',
    });
    res.end(
      failure
        ? callbackPage(
            'Sign-in failed',
            `${failure}. Return to your terminal and try again.`,
          )
        : callbackPage(
            'Signed in to 37 Audits',
            'You can close this tab and return to your terminal.',
          ),
      () => req.socket.destroy(),
    );

    clearTimeout(timeout);
    listening.close();
    if (failure) {
      rejectCallback(new OAuthError(failure, 'oauth_error'));
    } else if (code && state) {
      resolveCallback({ code, state });
    }
  });

  return {
    port,
    redirectUri: redirectUriFor(port),
    waitForCallback,
    close() {
      clearTimeout(timeout);
      listening.close();
    },
  };
}

async function postToken(
  authUrl: string,
  body: URLSearchParams,
  label: string,
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(`${authUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    throw new OAuthError(
      timedOut
        ? `${label} timed out after 30s. Check your connection and try again.`
        : `Could not reach the authorization server at ${authUrl}. Check your connection and try again.`,
      'network_error',
    );
  }

  if (!response.ok) {
    let detail = '';
    try {
      const data = (await response.json()) as Record<string, unknown>;
      detail = String(
        data.error_description ??
          data.msg ??
          data.error_code ??
          data.error ??
          '',
      );
    } catch {
      /* no JSON body */
    }
    throw new OAuthError(
      `${label} failed (HTTP ${response.status})${detail ? `: ${detail}` : ''}`,
      'oauth_error',
    );
  }

  return parseTokenResponse(await response.json());
}

export function exchangeAuthorizationCode(params: {
  authUrl: string;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<TokenResponse> {
  return postToken(
    params.authUrl,
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: params.clientId,
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
    }),
    'Token exchange',
  );
}

export function refreshAccessToken(params: {
  authUrl: string;
  clientId: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  return postToken(
    params.authUrl,
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: params.clientId,
      refresh_token: params.refreshToken,
    }),
    'Token refresh',
  );
}

export function credentialFromTokens(
  tokens: TokenResponse,
  server: { authUrl: string; clientId: string },
): OAuthCredential {
  return {
    type: 'oauth',
    auth_url: server.authUrl,
    client_id: server.clientId,
    access_token: tokens.access_token,
    access_token_expires_at: getJwtExp(tokens.access_token),
    refresh_token: tokens.refresh_token,
  };
}

export function isFresh(
  credential: OAuthCredential,
  nowSeconds: number,
): boolean {
  return (
    credential.access_token_expires_at >
    nowSeconds + TOKEN_EXPIRY_LEEWAY_SECONDS
  );
}

/**
 * Returns a credential whose access token is valid, refreshing and persisting
 * it when needed. Runs under the credentials lock and re-reads the file first,
 * because another 37audits process may have refreshed in the meantime (the
 * server rotates refresh tokens).
 */
export function ensureFreshOAuthCredential(
  credential: OAuthCredential,
  options: { force?: boolean } = {},
): Promise<OAuthCredential> {
  return withFileLock(getCredentialsLockPath(), async () => {
    let current = credential;
    try {
      const stored = readCredentials()?.credential;
      if (stored?.type === 'oauth') {
        current = stored;
      }
    } catch {
      /* unreadable file: refresh with what we were given */
    }

    const now = Math.floor(Date.now() / 1000);
    if (!options.force && isFresh(current, now)) {
      return current;
    }
    if (
      options.force &&
      current.access_token !== credential.access_token &&
      isFresh(current, now)
    ) {
      // Someone else already refreshed; their newer token is the one to use.
      return current;
    }

    let tokens: TokenResponse;
    try {
      tokens = await refreshAccessToken({
        authUrl: current.auth_url,
        clientId: current.client_id,
        refreshToken: current.refresh_token,
      });
    } catch (err) {
      if (err instanceof OAuthError && err.code === 'network_error') {
        throw err;
      }
      throw new OAuthError(
        `Your session has expired. ${LOGIN_AGAIN}`,
        'auth_error',
      );
    }

    const next = credentialFromTokens(tokens, {
      authUrl: current.auth_url,
      clientId: current.client_id,
    });
    writeCredentials({ version: 1, credential: next });
    return next;
  });
}
