import { afterEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../../src/lib/api';
import { waitForGroup } from '../../src/lib/poll';
import { captureTestEnv, mockFetch } from '../helpers';

const client = () =>
  new ApiClient(
    { type: 'api_key', key: 'k', source: 'env' },
    'https://api.example',
  );

const page = (...statuses: string[]) => ({
  content: statuses.map((status, i) => ({
    id: `r${i}`,
    auditorId: `a${i}`,
    status,
  })),
  page: { size: 100, number: 0, totalElements: statuses.length, totalPages: 1 },
});

describe('waitForGroup', () => {
  const restore = captureTestEnv();
  afterEach(restore);

  it('polls until nothing is pending', async () => {
    let calls = 0;
    const { requests } = mockFetch([
      {
        path: '/v2/monitored-urls/u1/audit-results',
        handler: () =>
          ++calls < 3 ? page('pending', 'success') : page('fail', 'success'),
      },
    ]);
    const ticks: number[] = [];
    const result = await waitForGroup(client(), {
      urlId: 'u1',
      groupId: 'g1',
      deadline: Date.now() + 5_000,
      intervalMs: 5,
      onTick: (pending) => ticks.push(pending),
    });
    expect(result).toMatchObject({ pending: 0, timedOut: false });
    expect(result.results.map((r) => r.status)).toEqual(['fail', 'success']);
    expect(ticks).toEqual([1, 1]);
    expect(requests[0].url.search).toBe('?groupId=g1&size=100');
  });

  it('gives up at the deadline and reports what is still pending', async () => {
    mockFetch([
      { path: '/v2/monitored-urls/u1/audit-results', body: page('pending') },
    ]);
    const result = await waitForGroup(client(), {
      urlId: 'u1',
      groupId: 'g1',
      deadline: Date.now() + 30,
      intervalMs: 5,
    });
    expect(result).toMatchObject({ pending: 1, timedOut: true });
  });

  it('keeps polling through transient server errors', async () => {
    let calls = 0;
    const errors: string[] = [];
    mockFetch([
      {
        path: '/v2/monitored-urls/u1/audit-results',
        handler: () =>
          ++calls === 1
            ? { status: 503, body: { detail: 'down' } }
            : page('success'),
      },
    ]);
    const result = await waitForGroup(client(), {
      urlId: 'u1',
      groupId: 'g1',
      deadline: Date.now() + 10_000,
      intervalMs: 5,
      onError: (m) => errors.push(m),
    });
    expect(result.timedOut).toBe(false);
    expect(errors).toHaveLength(1);
  });

  it('stops on a non-transient error such as 404', async () => {
    mockFetch([
      { path: '/v2/monitored-urls/u1/audit-results', status: 404, body: {} },
    ]);
    await expect(
      waitForGroup(client(), {
        urlId: 'u1',
        groupId: 'g1',
        deadline: Date.now() + 1000,
        intervalMs: 5,
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
