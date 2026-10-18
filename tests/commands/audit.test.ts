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
import { auditLatestCommand } from '../../src/commands/audit/latest';
import { auditRunCommand } from '../../src/commands/audit/run';
import {
  captureTestEnv,
  expectExit1,
  expectExitCode,
  lastError,
  lastJson,
  mockExitThrow,
  mockFetch,
  setupOutputSpies,
} from '../helpers';

const URL_ID = '8d4f5fa1-f67b-47f7-939b-2e8b9098e39a';
const monitoredUrl = {
  id: URL_ID,
  projectId: 'p1',
  url: 'https://www.example.com',
  status: 'active',
};
const started = [
  {
    id: 'r1',
    urlId: URL_ID,
    auditor: { id: 'a1', name: 'HTTPS' },
    status: 'pending',
    groupId: 'g1',
  },
  {
    id: 'r2',
    urlId: URL_ID,
    auditor: { id: 'a2', name: 'IPv6' },
    status: 'pending',
    groupId: 'g1',
  },
];
const page = (...statuses: string[]) => ({
  content: statuses.map((status, i) => ({
    id: `r${i}`,
    auditorId: `a${i}`,
    auditorName: `A${i}`,
    status,
    createdAt: 'x',
  })),
  page: { size: 100, number: 0, totalElements: statuses.length, totalPages: 1 },
});

describe('audit run', () => {
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

  it('starts a run with the note and auditors, and records group_id for Actions', async () => {
    const file = join(tmpdir(), `gh-${process.pid}-run`);
    writeFileSync(file, '');
    process.env.GITHUB_OUTPUT = file;
    const { requests } = mockFetch([
      { path: `/v2/monitored-urls/${URL_ID}`, body: monitoredUrl },
      {
        method: 'POST',
        path: `/v2/monitored-urls/${URL_ID}/audit-results/run`,
        status: 202,
        body: started,
      },
    ]);
    await auditRunCommand.parseAsync(
      [
        '--url-id',
        URL_ID,
        '--note',
        'Deploy of x',
        '--auditor',
        'a1',
        '--auditor',
        'a2',
      ],
      { from: 'user' },
    );
    const run = requests.find(
      (r) => r.method === 'POST',
    ) as (typeof requests)[number];
    expect(run.url.searchParams.get('note')).toBe('Deploy of x');
    expect(run.url.searchParams.getAll('auditorId')).toEqual(['a1', 'a2']);
    expect(lastJson(spies.logSpy)).toEqual(started);
    expect(readFileSync(file, 'utf-8')).toBe('group_id=g1\n');
  });

  it('requires exactly one target', async () => {
    await expectExit1(() => auditRunCommand.parseAsync([], { from: 'user' }));
    expect(lastError(spies.errorSpy).code).toBe('missing_target');
    await expectExit1(() =>
      auditRunCommand.parseAsync(['--url-id', URL_ID, '--url', 'https://x'], {
        from: 'user',
      }),
    );
    expect(lastError(spies.errorSpy).code).toBe('ambiguous_target');
  });

  it('surfaces insufficient credits', async () => {
    mockFetch([
      { path: `/v2/monitored-urls/${URL_ID}`, body: monitoredUrl },
      {
        method: 'POST',
        path: `/v2/monitored-urls/${URL_ID}/audit-results/run`,
        status: 402,
        body: { detail: 'Insufficient credits. Required: 10, Available: 2' },
      },
    ]);
    await expectExit1(() =>
      auditRunCommand.parseAsync(['--url-id', URL_ID], { from: 'user' }),
    );
    expect(lastError(spies.errorSpy)).toMatchObject({
      code: 'insufficient_credits',
      message: 'Insufficient credits. Required: 10, Available: 2',
    });
  });

  it('--wait polls until final and prints the results', async () => {
    let polls = 0;
    mockFetch([
      { path: `/v2/monitored-urls/${URL_ID}`, body: monitoredUrl },
      {
        method: 'POST',
        path: `/v2/monitored-urls/${URL_ID}/audit-results/run`,
        status: 202,
        body: started,
      },
      {
        path: `/v2/monitored-urls/${URL_ID}/audit-results`,
        handler: () =>
          ++polls < 3 ? page('pending', 'success') : page('warning', 'success'),
      },
    ]);
    await auditRunCommand.parseAsync(
      ['--url-id', URL_ID, '--wait', '--interval', '5ms', '--timeout', '5s'],
      { from: 'user' },
    );
    expect(lastJson(spies.logSpy)).toMatchObject({
      groupId: 'g1',
      pending: 0,
      timedOut: false,
    });
    expect(polls).toBe(3);
  });

  it('a --wait timeout is only a warning', async () => {
    mockFetch([
      { path: `/v2/monitored-urls/${URL_ID}`, body: monitoredUrl },
      {
        method: 'POST',
        path: `/v2/monitored-urls/${URL_ID}/audit-results/run`,
        status: 202,
        body: started,
      },
      {
        path: `/v2/monitored-urls/${URL_ID}/audit-results`,
        body: page('pending'),
      },
    ]);
    await auditRunCommand.parseAsync(
      ['--url-id', URL_ID, '--wait', '--interval', '5ms', '--timeout', '30ms'],
      { from: 'user' },
    );
    expect(lastJson(spies.logSpy)).toMatchObject({
      pending: 1,
      timedOut: true,
    });
    expect(lastJson(spies.errorSpy)).toMatchObject({
      warning: { message: expect.stringContaining('Timed out') },
    });
  });

  it('--fail-on exits 2 on a failing result and 1 on a timeout', async () => {
    let body = page('fail', 'success');
    mockFetch([
      { path: `/v2/monitored-urls/${URL_ID}`, body: monitoredUrl },
      {
        method: 'POST',
        path: `/v2/monitored-urls/${URL_ID}/audit-results/run`,
        status: 202,
        body: started,
      },
      {
        path: `/v2/monitored-urls/${URL_ID}/audit-results`,
        handler: () => body,
      },
    ]);
    await expectExitCode(2, () =>
      auditRunCommand.parseAsync(
        ['--url-id', URL_ID, '--fail-on', 'fail', '--interval', '5ms'],
        { from: 'user' },
      ),
    );
    body = page('warning');
    await auditRunCommand.parseAsync(
      ['--url-id', URL_ID, '--fail-on', 'fail', '--interval', '5ms'],
      { from: 'user' },
    );
    await expectExitCode(2, () =>
      auditRunCommand.parseAsync(
        ['--url-id', URL_ID, '--fail-on', 'warning', '--interval', '5ms'],
        { from: 'user' },
      ),
    );
    body = page('pending');
    await expectExit1(() =>
      auditRunCommand.parseAsync(
        [
          '--url-id',
          URL_ID,
          '--fail-on',
          'fail',
          '--interval',
          '5ms',
          '--timeout',
          '20ms',
        ],
        { from: 'user' },
      ),
    );
    expect(lastError(spies.errorSpy).code).toBe('wait_timeout');
  });

  it('rejects bad durations and levels', async () => {
    await expectExit1(() =>
      auditRunCommand.parseAsync(['--url-id', URL_ID, '--timeout', 'soon'], {
        from: 'user',
      }),
    );
    expect(lastError(spies.errorSpy).code).toBe('invalid_duration');
    await expectExit1(() =>
      auditRunCommand.parseAsync(['--url-id', URL_ID, '--fail-on', 'info'], {
        from: 'user',
      }),
    );
    expect(lastError(spies.errorSpy).code).toBe('invalid_options');
  });
});

describe('audit latest', () => {
  const restore = captureTestEnv();
  let spies: ReturnType<typeof setupOutputSpies>;
  let exitSpy: MockInstance;

  beforeEach(() => {
    process.env.THIRTYSEVENAUDITS_API_KEY = 'tsa_test_k';
    process.env.THIRTYSEVENAUDITS_API_BASE_URL = 'https://api.example';
    spies = setupOutputSpies();
    exitSpy = mockExitThrow();
  });
  afterEach(() => {
    restore();
    exitSpy.mockRestore();
  });

  it('prints the latest results as JSON and gates on --fail-on', async () => {
    const latest = page('warning', 'success', 'pending').content;
    mockFetch([
      { path: `/v2/monitored-urls/${URL_ID}`, body: monitoredUrl },
      {
        path: `/v2/monitored-urls/${URL_ID}/audit-results/latest`,
        body: latest,
      },
    ]);
    await auditLatestCommand.parseAsync(['--url-id', URL_ID], { from: 'user' });
    expect(lastJson(spies.logSpy)).toEqual(latest);
    await auditLatestCommand.parseAsync(
      ['--url-id', URL_ID, '--fail-on', 'fail'],
      { from: 'user' },
    );
    await expectExitCode(2, () =>
      auditLatestCommand.parseAsync(
        ['--url-id', URL_ID, '--fail-on', 'warning'],
        { from: 'user' },
      ),
    );
  });
});
