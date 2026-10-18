import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getConfigDir,
  getCredentialsPath,
  readCredentials,
  removeCredentials,
  storeCredential,
} from '../../src/lib/config';
import { captureTestEnv } from '../helpers';

describe('credentials file', () => {
  const restore = captureTestEnv();
  afterEach(restore);

  it('is created under XDG_CONFIG_HOME/37audits with mode 0600', () => {
    const path = storeCredential({ type: 'api_key', api_key: 'tsa_test_x' });
    expect(path).toBe(getCredentialsPath());
    expect(path.startsWith(getConfigDir())).toBe(true);
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(statSync(getConfigDir()).mode & 0o777).toBe(0o700);
    }
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({
      version: 1,
      credential: { type: 'api_key', api_key: 'tsa_test_x' },
    });
  });

  it('round-trips an OAuth credential', () => {
    const credential = {
      type: 'oauth' as const,
      auth_url: 'https://auth.example/auth/v1',
      client_id: 'cid',
      access_token: 'at',
      access_token_expires_at: 123,
      refresh_token: 'rt',
    };
    storeCredential(credential);
    expect(readCredentials()).toEqual({ version: 1, credential });
  });

  it('returns null when there is no file', () => {
    expect(readCredentials()).toBeNull();
  });

  it('removes the file and reports whether it existed', () => {
    storeCredential({ type: 'api_key', api_key: 'tsa_test_x' });
    expect(removeCredentials().removed).toBe(true);
    expect(removeCredentials().removed).toBe(false);
  });

  it('refuses a corrupt file with a hint to log in again', () => {
    storeCredential({ type: 'api_key', api_key: 'tsa_test_x' });
    writeFileSync(getCredentialsPath(), '{not json');
    expect(() => readCredentials()).toThrow(/not valid JSON.*37audits login/);
    writeFileSync(getCredentialsPath(), JSON.stringify({ version: 2 }));
    expect(() => readCredentials()).toThrow(/unexpected format/);
  });
});
