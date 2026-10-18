import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
} from 'vitest';
import { loginCommand } from '../../src/commands/login';
import { readCredentials } from '../../src/lib/config';
import {
  captureTestEnv,
  expectExit1,
  lastError,
  lastJson,
  mockExitThrow,
  mockFetch,
  setupOutputSpies,
} from '../helpers';

describe('login', () => {
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

  it('validates and stores --api-key, reporting the organization', async () => {
    const { requests } = mockFetch([
      {
        path: '/v2/me',
        body: {
          userId: 'u',
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
    await loginCommand.parseAsync(['--api-key', 'tsa_test_abc'], {
      from: 'user',
    });
    expect(
      (requests[0].init.headers as Record<string, string>)['x-api-key'],
    ).toBe('tsa_test_abc');
    expect(readCredentials()?.credential).toEqual({
      type: 'api_key',
      api_key: 'tsa_test_abc',
    });
    expect(lastJson(spies.logSpy)).toMatchObject({
      success: true,
      authKind: 'api_key',
      organization: 'Acme',
      role: 'admin',
    });
  });

  it('falls back to /v2/organizations on an API without /v2/me', async () => {
    mockFetch([
      { path: '/v2/me', status: 404, body: {} },
      { path: '/v2/organizations', body: [] },
    ]);
    await loginCommand.parseAsync(['--api-key', 'tsa_test_abc'], {
      from: 'user',
    });
    expect(lastJson(spies.logSpy)).toMatchObject({
      success: true,
      authKind: 'api_key',
    });
  });

  it('rejects a key the API refuses and stores nothing', async () => {
    mockFetch([{ path: '/v2/me', status: 401, body: {} }]);
    await expectExit1(() =>
      loginCommand.parseAsync(['--api-key', 'tsa_test_bad'], { from: 'user' }),
    );
    expect(lastError(spies.errorSpy).code).toBe('auth_error');
    expect(readCredentials()).toBeNull();
  });

  it('rejects keys without the tsa_ prefix', async () => {
    await expectExit1(() =>
      loginCommand.parseAsync(['--api-key', 're_123'], { from: 'user' }),
    );
    expect(lastError(spies.errorSpy).code).toBe('invalid_key_format');
  });

  it('needs --api-key when not interactive', async () => {
    await expectExit1(() => loginCommand.parseAsync([], { from: 'user' }));
    expect(lastError(spies.errorSpy)).toMatchObject({
      code: 'missing_api_key',
      message: expect.stringContaining('THIRTYSEVENAUDITS_API_KEY'),
    });
  });
});
