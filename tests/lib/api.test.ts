import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../../src/lib/api';
import { storeCredential } from '../../src/lib/config';
import {
  captureTestEnv,
  jsonResponse,
  makeJwt,
  mockFetch,
  nowSeconds,
} from '../helpers';

const apiKeyClient = () =>
  new ApiClient(
    { type: 'api_key', key: 'tsa_test_k', source: 'env' },
    'https://api.example',
  );

describe('ApiClient', () => {
  const restore = captureTestEnv();
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    restore();
  });

  it('sends x-api-key, Accept and a user agent, and repeats array query values', async () => {
    const { requests } = mockFetch([{ path: '/v2/thing', body: { ok: true } }]);
    const result = await apiKeyClient().request('GET', '/v2/thing', {
      query: { a: ['1', '2'], b: undefined, c: 3 },
    });
    expect(result).toEqual({ ok: true });
    const [{ url, init }] = requests;
    expect(url.search).toBe('?a=1&a=2&c=3');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('tsa_test_k');
    expect(headers.Accept).toBe('application/json');
    expect(headers['User-Agent']).toMatch(/^37audits-cli\//);
  });

  it('JSON-encodes bodies', async () => {
    const { requests } = mockFetch([
      { method: 'POST', path: '/v2/thing', status: 201, body: {} },
    ]);
    await apiKeyClient().request('POST', '/v2/thing', { body: { a: 1 } });
    expect(requests[0].init.body).toBe('{"a":1}');
    expect(
      (requests[0].init.headers as Record<string, string>)['Content-Type'],
    ).toBe('application/json');
  });

  it('maps ProblemDetail errors to codes and keeps the detail', async () => {
    mockFetch([
      {
        path: '/v2/402',
        status: 402,
        body: { detail: 'Insufficient credits. Required: 5, Available: 0' },
      },
      { path: '/v2/403', status: 403, body: { title: 'Forbidden' } },
      { path: '/v2/404', status: 404, body: {} },
      { path: '/v2/409', status: 409, body: { detail: 'already active' } },
      { path: '/v2/422', status: 422, body: { detail: 'bad' } },
      { path: '/v2/500', status: 500, body: { detail: 'boom' } },
    ]);
    const client = apiKeyClient();
    const expectError = async (
      path: string,
      code: string,
      message?: string,
    ) => {
      const err = await client
        .request('GET', path, { retry: false })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe(code);
      if (message) {
        expect(err.message).toBe(message);
      }
    };
    await expectError(
      '/v2/402',
      'insufficient_credits',
      'Insufficient credits. Required: 5, Available: 0',
    );
    await expectError('/v2/403', 'forbidden', 'Forbidden');
    await expectError('/v2/404', 'not_found', 'HTTP 404');
    await expectError('/v2/409', 'conflict', 'already active');
    await expectError('/v2/422', 'request_error', 'bad');
    await expectError('/v2/500', 'server_error', 'boom');
  });

  it('explains a rejected API key', async () => {
    mockFetch([{ path: '/v2/me', status: 401, body: {} }]);
    const err = await apiKeyClient()
      .request('GET', '/v2/me')
      .catch((e) => e);
    expect(err.code).toBe('auth_error');
    expect(err.message).toContain('THIRTYSEVENAUDITS_API_KEY');
  });

  it('retries GET on 503 and succeeds', async () => {
    let calls = 0;
    mockFetch([
      {
        path: '/v2/flaky',
        handler: () =>
          ++calls < 3
            ? { status: 503, body: {} }
            : { status: 200, body: { ok: 1 } },
      },
    ]);
    const result = await apiKeyClient().request('GET', '/v2/flaky');
    expect(result).toEqual({ ok: 1 });
    expect(calls).toBe(3);
  });

  it('does not retry POST', async () => {
    let calls = 0;
    mockFetch([
      {
        method: 'POST',
        path: '/v2/once',
        handler: () => {
          calls++;
          return { status: 503, body: {} };
        },
      },
    ]);
    await expect(
      apiKeyClient().request('POST', '/v2/once'),
    ).rejects.toMatchObject({
      code: 'server_error',
    });
    expect(calls).toBe(1);
  });

  it('reports unreachable hosts as network_error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('fetch failed'),
    );
    await expect(
      apiKeyClient().request('GET', '/v2/x', { retry: false }),
    ).rejects.toMatchObject({ code: 'network_error' });
  });

  it('returns undefined for 204', async () => {
    mockFetch([{ method: 'DELETE', path: '/v2/x', status: 204 }]);
    expect(await apiKeyClient().request('DELETE', '/v2/x')).toBeUndefined();
  });

  it('refreshes an OAuth session once on 401 and retries with the new token', async () => {
    const newToken = makeJwt({ exp: nowSeconds() + 3600 });
    const credential = {
      type: 'oauth' as const,
      auth_url: 'https://auth.example/auth/v1',
      client_id: 'cid',
      access_token: makeJwt({ exp: nowSeconds() + 1800 }),
      access_token_expires_at: nowSeconds() + 1800,
      refresh_token: 'rt',
    };
    storeCredential(credential);
    const seen: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/oauth/token')) {
        return jsonResponse(200, {
          access_token: newToken,
          refresh_token: 'rt2',
        });
      }
      const auth = (init?.headers as Record<string, string>).Authorization;
      seen.push(auth);
      return auth === `Bearer ${newToken}`
        ? jsonResponse(200, { ok: true })
        : jsonResponse(401, {});
    });
    const client = new ApiClient(
      { type: 'oauth', credential, source: 'config' },
      'https://api.example',
    );
    expect(await client.request('GET', '/v2/x')).toEqual({ ok: true });
    expect(seen).toEqual([
      `Bearer ${credential.access_token}`,
      `Bearer ${newToken}`,
    ]);
  });
});
