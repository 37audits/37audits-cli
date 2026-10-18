import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
} from 'vitest';
import { mwEndCommand } from '../../src/commands/mw/end';
import { mwListCommand } from '../../src/commands/mw/list';
import { mwStartCommand } from '../../src/commands/mw/start';
import {
  captureTestEnv,
  expectExit1,
  lastError,
  lastJson,
  mockExitThrow,
  mockFetch,
  setupOutputSpies,
} from '../helpers';

const PROJECT = 'c60155cc-a2e9-4bea-93fd-5c00d721c205';
const BASE = `/v2/projects/${PROJECT}/maintenance-windows`;
const window = (status: string, extra: Record<string, unknown> = {}) => ({
  id: 'w1',
  projectId: PROJECT,
  reason: 'Deploy',
  startsAt: '2026-10-18T10:00:00Z',
  endsAt: null,
  leadMinutes: 5,
  status,
  createdAt: 'x',
  updatedAt: 'x',
  ...extra,
});
const page = (...statuses: string[]) => ({
  content: statuses.map((status, i) => ({
    id: `r${i}`,
    auditorId: `a${i}`,
    status,
    createdAt: 'x',
  })),
  page: { size: 100, number: 0, totalElements: statuses.length, totalPages: 1 },
});

describe('mw commands', () => {
  const restore = captureTestEnv();
  let spies: ReturnType<typeof setupOutputSpies>;
  let exitSpy: MockInstance;

  beforeEach(() => {
    process.env.THIRTYSEVENAUDITS_API_KEY = 'tsa_test_k';
    process.env.THIRTYSEVENAUDITS_API_BASE_URL = 'https://api.example';
    delete process.env.GITHUB_OUTPUT;
    spies = setupOutputSpies();
    exitSpy = mockExitThrow();
  });
  afterEach(() => {
    restore();
    exitSpy.mockRestore();
  });

  it('start posts runAuditors, reason and endsAt, and records window_id', async () => {
    const file = join(tmpdir(), `gh-${process.pid}-mw`);
    writeFileSync(file, '');
    process.env.GITHUB_OUTPUT = file;
    const { requests } = mockFetch([
      {
        method: 'POST',
        path: `${BASE}/start`,
        status: 201,
        body: window('active', { runs: [] }),
      },
    ]);
    const before = Date.now();
    await mwStartCommand.parseAsync(
      [
        '--project',
        PROJECT,
        '--run-auditors',
        '--reason',
        'Deploy',
        '--ends-in',
        '30m',
      ],
      { from: 'user' },
    );
    const body = JSON.parse(String(requests[0].init.body));
    expect(body).toMatchObject({ runAuditors: true, reason: 'Deploy' });
    const endsAt = Date.parse(body.endsAt);
    expect(endsAt - before).toBeGreaterThanOrEqual(30 * 60_000 - 1000);
    expect(endsAt - before).toBeLessThanOrEqual(30 * 60_000 + 5000);
    expect(readFileSync(file, 'utf-8')).toBe('window_id=w1\n');
    expect(lastJson(spies.logSpy)).toMatchObject({
      id: 'w1',
      status: 'active',
    });
  });

  it('start derives the project from --url-id', async () => {
    const { requests } = mockFetch([
      {
        path: '/v2/monitored-urls/u1',
        body: { id: 'u1', projectId: PROJECT, url: 'https://x' },
      },
      {
        method: 'POST',
        path: `${BASE}/start`,
        status: 201,
        body: window('active'),
      },
    ]);
    await mwStartCommand.parseAsync(['--url-id', 'u1'], { from: 'user' });
    expect(JSON.parse(String(requests[1].init.body))).toEqual({
      runAuditors: false,
    });
  });

  it('start --wait polls every run group', async () => {
    const polls: Record<string, number> = {};
    mockFetch([
      {
        method: 'POST',
        path: `${BASE}/start`,
        status: 201,
        body: window('active', {
          runs: [
            { monitoredUrlId: 'u1', groupId: 'g1' },
            { monitoredUrlId: 'u2', groupId: 'g2' },
          ],
        }),
      },
      {
        path: /^\/v2\/monitored-urls\/u[12]\/audit-results$/,
        handler: (url) => {
          const g = url.searchParams.get('groupId') ?? '';
          polls[g] = (polls[g] ?? 0) + 1;
          return polls[g] < 2
            ? page('pending', 'success')
            : page('success', 'success');
        },
      },
    ]);
    await mwStartCommand.parseAsync(
      [
        '--project',
        PROJECT,
        '--run-auditors',
        '--wait',
        '--interval',
        '5ms',
        '--timeout',
        '5s',
      ],
      { from: 'user' },
    );
    expect(polls).toEqual({ g1: 2, g2: 2 });
    expect(lastJson(spies.logSpy)).toMatchObject({
      id: 'w1',
      wait: { results: 4, pending: 0, timedOut: false },
    });
  });

  it('start reports a conflict with the active window', async () => {
    mockFetch([
      {
        method: 'POST',
        path: `${BASE}/start`,
        status: 409,
        body: { detail: 'A maintenance window is already active' },
      },
    ]);
    await expectExit1(() =>
      mwStartCommand.parseAsync(['--project', PROJECT], { from: 'user' }),
    );
    expect(lastError(spies.errorSpy)).toMatchObject({
      code: 'window_conflict',
      message: expect.stringContaining('already active'),
    });
  });

  it('start validates its options', async () => {
    await expectExit1(() =>
      mwStartCommand.parseAsync(['--project', PROJECT, '--wait'], {
        from: 'user',
      }),
    );
    expect(lastError(spies.errorSpy).code).toBe('invalid_options');
    await expectExit1(() =>
      mwStartCommand.parseAsync(
        [
          '--project',
          PROJECT,
          '--ends-in',
          '1h',
          '--ends-at',
          '2030-01-01T00:00:00Z',
        ],
        { from: 'user' },
      ),
    );
    expect(lastError(spies.errorSpy).code).toBe('invalid_options');
    await expectExit1(() =>
      mwStartCommand.parseAsync(
        ['--project', PROJECT, '--ends-at', 'tomorrow'],
        { from: 'user' },
      ),
    );
    expect(lastError(spies.errorSpy).code).toBe('invalid_duration');
    await expectExit1(() => mwStartCommand.parseAsync([], { from: 'user' }));
    expect(lastError(spies.errorSpy).code).toBe('missing_target');
  });

  it('end uses the given id, or the active window, and maps 409', async () => {
    let ended = false;
    const { requests } = mockFetch([
      {
        path: BASE,
        body: [window('ended', { id: 'old' }), window('active', { id: 'w1' })],
      },
      {
        method: 'POST',
        path: `${BASE}/w1/end`,
        handler: () => {
          if (ended) {
            return {
              status: 409,
              body: { detail: 'The maintenance window is not active' },
            };
          }
          ended = true;
          return {
            status: 200,
            body: window('ended', {
              runs: [{ monitoredUrlId: 'u1', groupId: 'g9' }],
            }),
          };
        },
      },
    ]);
    await mwEndCommand.parseAsync(['--project', PROJECT], { from: 'user' });
    expect(requests.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      `GET ${BASE}`,
      `POST ${BASE}/w1/end`,
    ]);
    expect(lastJson(spies.logSpy)).toMatchObject({
      status: 'ended',
      runs: [{ groupId: 'g9' }],
    });

    await expectExit1(() =>
      mwEndCommand.parseAsync(['w1', '--project', PROJECT], { from: 'user' }),
    );
    expect(lastError(spies.errorSpy).code).toBe('window_not_active');
  });

  it('end fails when nothing is active', async () => {
    mockFetch([{ path: BASE, body: [window('ended')] }]);
    await expectExit1(() =>
      mwEndCommand.parseAsync(['--project', PROJECT], { from: 'user' }),
    );
    expect(lastError(spies.errorSpy).code).toBe('no_active_window');
  });

  it('list filters by status and limits', async () => {
    mockFetch([
      {
        path: BASE,
        body: [
          window('active', { id: 'a' }),
          window('ended', { id: 'b' }),
          window('ended', { id: 'c' }),
        ],
      },
    ]);
    await mwListCommand.parseAsync(
      ['--project', PROJECT, '--status', 'ended', '--limit', '1'],
      { from: 'user' },
    );
    expect(
      (lastJson(spies.logSpy) as { id: string }[]).map((w) => w.id),
    ).toEqual(['b']);
    await expectExit1(() =>
      mwListCommand.parseAsync(['--project', PROJECT, '--status', 'open'], {
        from: 'user',
      }),
    );
    expect(lastError(spies.errorSpy).code).toBe('invalid_options');
  });
});
