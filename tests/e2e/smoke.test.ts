import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

/**
 * Read-only smoke test against a real API. Needs THIRTYSEVENAUDITS_API_KEY
 * (and optionally THIRTYSEVENAUDITS_API_BASE_URL, E2E_PROJECT_ID). Run with
 * `npm run test:e2e`.
 */
const run = promisify(execFile);
const cli = (...args: string[]) =>
  run('npx', ['tsx', 'src/cli.ts', ...args, '--json', '-q'], {
    env: { ...process.env, CI: 'true' },
  });

const enabled = Boolean(process.env.THIRTYSEVENAUDITS_API_KEY);

describe.skipIf(!enabled)('e2e smoke', () => {
  it('whoami answers for the configured key', async () => {
    const { stdout } = await cli('whoami');
    expect(JSON.parse(stdout)).toMatchObject({
      authenticated: true,
      authKind: 'api_key',
    });
  });

  it.skipIf(!process.env.E2E_PROJECT_ID)(
    'mw list answers for the project',
    async () => {
      const { stdout } = await cli(
        'mw',
        'list',
        '--project',
        process.env.E2E_PROJECT_ID ?? '',
      );
      expect(Array.isArray(JSON.parse(stdout))).toBe(true);
    },
  );
});
