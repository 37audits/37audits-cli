import { afterEach, describe, expect, it } from 'vitest';
import { ApiClient } from '../../src/lib/api';
import {
  normalizeUrl,
  resolveMonitoredUrl,
  resolveProjectId,
} from '../../src/lib/resolve';
import { captureTestEnv, mockFetch } from '../helpers';

const client = () =>
  new ApiClient(
    { type: 'api_key', key: 'k', source: 'env' },
    'https://api.example',
  );

const urls = (projectId: string, ...addresses: string[]) =>
  addresses.map((url, i) => ({
    id: `${projectId}-url-${i}`,
    projectId,
    url,
    status: 'active',
  }));

describe('normalizeUrl', () => {
  it('ignores trailing slashes, host case and fragments', () => {
    expect(normalizeUrl('HTTPS://Example.com/')).toBe('https://example.com');
    expect(normalizeUrl('https://example.com/a/#top')).toBe(
      'https://example.com/a',
    );
    expect(normalizeUrl('https://example.com/a?x=1')).toBe(
      'https://example.com/a?x=1',
    );
    expect(normalizeUrl(' not a url/ ')).toBe('not a url');
  });
});

describe('resolveMonitoredUrl', () => {
  const restore = captureTestEnv();
  afterEach(restore);

  it('fetches by id', async () => {
    mockFetch([
      {
        path: '/v2/monitored-urls/u1',
        body: { id: 'u1', projectId: 'p1', url: 'https://a' },
      },
    ]);
    expect(
      (await resolveMonitoredUrl(client(), { urlId: 'u1' })).projectId,
    ).toBe('p1');
  });

  it('uses the API key organization from /v2/me and matches loosely', async () => {
    const { requests } = mockFetch([
      {
        path: '/v2/me',
        body: {
          userId: 'x',
          authKind: 'api_key',
          apiKey: { organizationId: 'org1', role: 'admin', id: 'k' },
        },
      },
      {
        path: '/v2/organizations/org1/projects',
        body: [{ id: 'p1' }, { id: 'p2' }],
      },
      {
        path: '/v2/projects/p1/monitored-urls',
        body: urls('p1', 'https://other.example'),
      },
      {
        path: '/v2/projects/p2/monitored-urls',
        body: urls('p2', 'https://www.example.com/'),
      },
    ]);
    const found = await resolveMonitoredUrl(client(), {
      url: 'https://WWW.example.com',
    });
    expect(found.id).toBe('p2-url-0');
    expect(requests.some((r) => r.url.pathname === '/v2/organizations')).toBe(
      false,
    );
  });

  it('walks every organization for a user and skips ones that answer 404', async () => {
    mockFetch([
      { path: '/v2/me', status: 404, body: {} },
      { path: '/v2/organizations', body: [{ id: 'org1' }, { id: 'org2' }] },
      {
        path: '/v2/organizations/org1/projects',
        status: 404,
        body: { detail: 'Organization not found' },
      },
      { path: '/v2/organizations/org2/projects', body: [{ id: 'p2' }] },
      {
        path: '/v2/projects/p2/monitored-urls',
        body: urls('p2', 'https://www.example.com'),
      },
    ]);
    expect(
      await resolveProjectId(client(), { url: 'https://www.example.com/' }),
    ).toBe('p2');
  });

  it('reports url_not_found and ambiguous matches', async () => {
    mockFetch([
      { path: '/v2/me', status: 404, body: {} },
      { path: '/v2/organizations', body: [{ id: 'org1' }] },
      { path: '/v2/organizations/org1/projects', body: [{ id: 'p1' }] },
      {
        path: '/v2/projects/p1/monitored-urls',
        body: urls('p1', 'https://dup', 'https://dup'),
      },
    ]);
    await expect(
      resolveMonitoredUrl(client(), { url: 'https://nope' }),
    ).rejects.toMatchObject({
      code: 'url_not_found',
    });
    await expect(
      resolveMonitoredUrl(client(), { url: 'https://dup' }),
    ).rejects.toMatchObject({
      code: 'ambiguous_target',
    });
  });

  it('passes --project through untouched', async () => {
    mockFetch([]);
    expect(await resolveProjectId(client(), { project: 'p9' })).toBe('p9');
  });
});
