import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCredentials, storeCredential } from '../../src/lib/config';
import {
  buildAuthorizeUrl,
  createCallbackServer,
  ensureFreshOAuthCredential,
  exchangeAuthorizationCode,
  generatePKCE,
  getJwtExp,
  OAuthError,
  parseTokenResponse,
} from '../../src/lib/oauth';
import { captureTestEnv, jsonResponse, makeJwt, nowSeconds } from '../helpers';

describe('generatePKCE', () => {
  it('produces an S256 challenge of the verifier and a state', () => {
    const { codeVerifier, codeChallenge, state } = generatePKCE();
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(generatePKCE().codeVerifier).not.toBe(codeVerifier);
  });
});

describe('getJwtExp', () => {
  it('reads exp', () => {
    expect(getJwtExp(makeJwt({ exp: 1750000000 }))).toBe(1750000000);
  });
  it('rejects malformed tokens', () => {
    expect(() => getJwtExp('nope')).toThrow(OAuthError);
    expect(() => getJwtExp(makeJwt({ sub: 'x' }))).toThrow(
      /invalid access token/,
    );
  });
});

describe('parseTokenResponse', () => {
  it('accepts the Supabase shape', () => {
    const body = {
      access_token: 'a.b.c',
      refresh_token: 'rt',
      expires_in: 3600,
      token_type: 'bearer',
      id_token: 'x.y.z',
    };
    expect(parseTokenResponse(body)).toEqual(body);
  });
  it('rejects bodies without tokens', () => {
    expect(() => parseTokenResponse({ access_token: 'a' })).toThrow(OAuthError);
    expect(() => parseTokenResponse('html')).toThrow(OAuthError);
  });
});

describe('buildAuthorizeUrl', () => {
  it('asks for code + S256 PKCE with the offline_access scope', () => {
    const url = new URL(
      buildAuthorizeUrl({
        authUrl: 'https://auth.example/auth/v1',
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:37371/callback',
        state: 's',
        codeChallenge: 'c',
      }),
    );
    expect(url.pathname).toBe('/auth/v1/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid',
      redirect_uri: 'http://127.0.0.1:37371/callback',
      response_type: 'code',
      scope: 'openid email profile offline_access',
      state: 's',
      code_challenge: 'c',
      code_challenge_method: 'S256',
    });
  });
});

describe('createCallbackServer', () => {
  const PORTS = [47371, 47372];
  let blocker: Server | undefined;
  afterEach(() => {
    blocker?.close();
    blocker = undefined;
  });

  it('falls back to the next registered port when one is busy', async () => {
    blocker = createServer();
    await new Promise<void>((r) =>
      (blocker as Server).listen(PORTS[0], '127.0.0.1', r),
    );
    const server = await createCallbackServer(PORTS);
    try {
      expect(server.port).toBe(PORTS[1]);
      expect(server.redirectUri).toBe(`http://127.0.0.1:${PORTS[1]}/callback`);
    } finally {
      server.close();
    }
  });

  it('fails with oauth_port_unavailable when every port is busy', async () => {
    blocker = createServer();
    await new Promise<void>((r) =>
      (blocker as Server).listen(PORTS[0], '127.0.0.1', r),
    );
    await expect(createCallbackServer([PORTS[0]])).rejects.toMatchObject({
      code: 'oauth_port_unavailable',
    });
  });

  it('resolves code and state from the callback and serves a page', async () => {
    const server = await createCallbackServer(PORTS);
    const response = await fetch(`${server.redirectUri}?code=abc&state=xyz`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Signed in');
    await expect(server.waitForCallback).resolves.toEqual({
      code: 'abc',
      state: 'xyz',
    });
  });

  it('rejects when the provider reports an error', async () => {
    const server = await createCallbackServer(PORTS);
    await fetch(`${server.redirectUri}?error=access_denied`);
    await expect(server.waitForCallback).rejects.toMatchObject({
      code: 'oauth_error',
      message: expect.stringContaining('denied'),
    });
  });
});

describe('exchangeAuthorizationCode', () => {
  afterEach(() => vi.restoreAllMocks());

  it('posts a form-encoded authorization_code grant', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, { access_token: 'a.b.c', refresh_token: 'rt' }),
      );
    await exchangeAuthorizationCode({
      authUrl: 'https://auth.example/auth/v1',
      clientId: 'cid',
      code: 'code',
      redirectUri: 'http://127.0.0.1:37371/callback',
      codeVerifier: 'ver',
    });
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe('https://auth.example/auth/v1/oauth/token');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'cid',
      code: 'code',
      redirect_uri: 'http://127.0.0.1:37371/callback',
      code_verifier: 'ver',
    });
  });

  it('surfaces the server error description', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(400, {
        error: 'invalid_grant',
        error_description: 'bad code',
      }),
    );
    await expect(
      exchangeAuthorizationCode({
        authUrl: 'https://auth.example/auth/v1',
        clientId: 'cid',
        code: 'code',
        redirectUri: 'r',
        codeVerifier: 'v',
      }),
    ).rejects.toThrow('Token exchange failed (HTTP 400): bad code');
  });
});

describe('ensureFreshOAuthCredential', () => {
  const restore = captureTestEnv();
  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  const credential = (expiresAt: number) => ({
    type: 'oauth' as const,
    auth_url: 'https://auth.example/auth/v1',
    client_id: 'cid',
    access_token: makeJwt({ exp: expiresAt }),
    access_token_expires_at: expiresAt,
    refresh_token: 'rt-old',
  });

  it('returns the credential untouched while it is fresh', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const fresh = credential(nowSeconds() + 3600);
    expect(await ensureFreshOAuthCredential(fresh)).toEqual(fresh);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refreshes an expiring token and persists the rotated pair', async () => {
    const newExp = nowSeconds() + 3600;
    const newToken = makeJwt({ exp: newExp });
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse(200, { access_token: newToken, refresh_token: 'rt-new' }),
      );
    const stale = credential(nowSeconds() + 10);
    storeCredential(stale);
    const next = await ensureFreshOAuthCredential(stale);
    expect(next.access_token).toBe(newToken);
    expect(next.refresh_token).toBe('rt-new');
    expect(next.access_token_expires_at).toBe(newExp);
    expect(readCredentials()?.credential).toEqual(next);
    expect(
      Object.fromEntries(spy.mock.calls[0][1]?.body as URLSearchParams),
    ).toEqual({
      grant_type: 'refresh_token',
      client_id: 'cid',
      refresh_token: 'rt-old',
    });
  });

  it('uses a newer credential another process already stored', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const stale = credential(nowSeconds() + 10);
    const newer = {
      ...credential(nowSeconds() + 3600),
      refresh_token: 'rt-newer',
    };
    storeCredential(newer);
    expect(await ensureFreshOAuthCredential(stale)).toEqual(newer);
    expect(spy).not.toHaveBeenCalled();
  });

  it('turns a rejected refresh into auth_error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(400, { error_code: 'refresh_token_not_found' }),
    );
    await expect(
      ensureFreshOAuthCredential(credential(nowSeconds() - 1)),
    ).rejects.toMatchObject({ code: 'auth_error' });
  });
});
