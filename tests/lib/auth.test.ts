import { afterEach, describe, expect, it } from 'vitest';
import { authHeaders, resolveAuthentication } from '../../src/lib/auth';
import { storeCredential } from '../../src/lib/config';
import { captureTestEnv, makeJwt, nowSeconds } from '../helpers';

describe('resolveAuthentication', () => {
  const restore = captureTestEnv();
  afterEach(restore);

  it('prefers the flag over the env var over the file', async () => {
    storeCredential({ type: 'api_key', api_key: 'tsa_test_file' });
    process.env.THIRTYSEVENAUDITS_API_KEY = 'tsa_test_env';
    expect(await resolveAuthentication('tsa_test_flag')).toEqual({
      type: 'api_key',
      key: 'tsa_test_flag',
      source: 'flag',
    });
    expect(await resolveAuthentication()).toEqual({
      type: 'api_key',
      key: 'tsa_test_env',
      source: 'env',
    });
    delete process.env.THIRTYSEVENAUDITS_API_KEY;
    expect(await resolveAuthentication()).toEqual({
      type: 'api_key',
      key: 'tsa_test_file',
      source: 'config',
    });
  });

  it('returns null without any credential', async () => {
    delete process.env.THIRTYSEVENAUDITS_API_KEY;
    expect(await resolveAuthentication()).toBeNull();
  });

  it('returns a stored OAuth session without refreshing when it is fresh', async () => {
    delete process.env.THIRTYSEVENAUDITS_API_KEY;
    const credential = {
      type: 'oauth' as const,
      auth_url: 'https://auth.example/auth/v1',
      client_id: 'cid',
      access_token: makeJwt({ exp: nowSeconds() + 3600 }),
      access_token_expires_at: nowSeconds() + 3600,
      refresh_token: 'rt',
    };
    storeCredential(credential);
    const resolved = await resolveAuthentication();
    expect(resolved).toEqual({ type: 'oauth', credential, source: 'config' });
    expect(resolved && authHeaders(resolved)).toEqual({
      Authorization: `Bearer ${credential.access_token}`,
    });
  });

  it('sends API keys in x-api-key', () => {
    expect(authHeaders({ type: 'api_key', key: 'k', source: 'env' })).toEqual({
      'x-api-key': 'k',
    });
  });
});
