import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
} from 'vitest';
import { logoutCommand } from '../../src/commands/logout';
import { whoamiCommand } from '../../src/commands/whoami';
import { readCredentials, storeCredential } from '../../src/lib/config';
import {
  captureTestEnv,
  expectExit1,
  lastError,
  lastJson,
  mockExitThrow,
  mockFetch,
  setupOutputSpies,
} from '../helpers';

describe('logout and whoami', () => {
  const restore = captureTestEnv();
  let spies: ReturnType<typeof setupOutputSpies>;
  let exitSpy: MockInstance;

  beforeEach(() => {
    delete process.env.THIRTYSEVENAUDITS_API_KEY;
    process.env.THIRTYSEVENAUDITS_API_BASE_URL = 'https://api.example';
    spies = setupOutputSpies();
    exitSpy = mockExitThrow();
  });
  afterEach(() => {
    restore();
    exitSpy.mockRestore();
  });

  it('logout removes the file and is idempotent', async () => {
    storeCredential({ type: 'api_key', api_key: 'tsa_test_x' });
    await logoutCommand.parseAsync([], { from: 'user' });
    expect(lastJson(spies.logSpy)).toMatchObject({
      success: true,
      removed: true,
    });
    expect(readCredentials()).toBeNull();
    await logoutCommand.parseAsync([], { from: 'user' });
    expect(lastJson(spies.logSpy)).toMatchObject({
      success: true,
      removed: false,
    });
  });

  it('whoami reports the env key and the API identity', async () => {
    process.env.THIRTYSEVENAUDITS_API_KEY = 'tsa_test_env';
    mockFetch([
      {
        path: '/v2/me',
        body: {
          userId: 'u1',
          email: 'ada@example.com',
          authKind: 'api_key',
          apiKey: {
            id: 'k',
            name: 'CI',
            role: 'admin',
            organizationId: 'o',
            organizationName: 'Acme',
          },
        },
      },
    ]);
    await whoamiCommand.parseAsync([], { from: 'user' });
    expect(lastJson(spies.logSpy)).toMatchObject({
      authenticated: true,
      authKind: 'api_key',
      source: 'env',
      userId: 'u1',
      email: 'ada@example.com',
      apiKey: { name: 'CI', organizationName: 'Acme' },
    });
  });

  it('whoami fails with not_authenticated when nothing is configured', async () => {
    await expectExit1(() => whoamiCommand.parseAsync([], { from: 'user' }));
    expect(lastError(spies.errorSpy).code).toBe('not_authenticated');
  });

  it('whoami reports auth_error for a rejected stored key', async () => {
    storeCredential({ type: 'api_key', api_key: 'tsa_test_old' });
    mockFetch([{ path: '/v2/me', status: 401, body: {} }]);
    await expectExit1(() => whoamiCommand.parseAsync([], { from: 'user' }));
    expect(lastError(spies.errorSpy).code).toBe('auth_error');
  });
});
