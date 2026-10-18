import { fail } from './actions';
import { type ApiClient, ApiError, type GlobalOpts } from './api';
import type { Me, MonitoredUrl, Organization, Project } from './types';

export interface TargetOpts {
  urlId?: string;
  url?: string;
}

export interface ProjectTargetOpts extends TargetOpts {
  project?: string;
}

/** Exactly one of --url-id / --url. */
export function requireTarget(opts: TargetOpts, globalOpts: GlobalOpts): void {
  if (opts.urlId && opts.url) {
    fail(
      globalOpts,
      'Pass either --url-id or --url, not both.',
      'ambiguous_target',
    );
  }
  if (!opts.urlId && !opts.url) {
    fail(
      globalOpts,
      'Which monitored URL? Pass --url-id <uuid> or --url <https://...>.',
      'missing_target',
    );
  }
}

/** Exactly one of --project / --url-id / --url. */
export function requireProjectTarget(
  opts: ProjectTargetOpts,
  globalOpts: GlobalOpts,
): void {
  const given = [opts.project, opts.urlId, opts.url].filter(Boolean).length;
  if (given > 1) {
    fail(
      globalOpts,
      'Pass only one of --project, --url-id or --url.',
      'ambiguous_target',
    );
  }
  if (given === 0) {
    fail(
      globalOpts,
      'Which project? Pass --project <uuid>, or --url-id / --url of one of its monitored URLs.',
      'missing_target',
    );
  }
}

/** GET /v2/me, or null on an API that predates it. */
export async function fetchMe(client: ApiClient): Promise<Me | null> {
  try {
    return await client.request<Me>('GET', '/v2/me');
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) {
      return null;
    }
    throw err;
  }
}

/** Normalises a URL for comparison: lower-case host, no trailing slash, no fragment. */
export function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const u = new URL(trimmed);
    u.hash = '';
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

async function organizationIds(client: ApiClient): Promise<string[]> {
  const me = await fetchMe(client);
  if (me?.apiKey?.organizationId) {
    return [me.apiKey.organizationId];
  }
  const orgs = await client.request<Organization[]>('GET', '/v2/organizations');
  return orgs.map((o) => o.id);
}

/** Every monitored URL the caller can see, walking organizations → projects → URLs. */
export async function listMonitoredUrls(
  client: ApiClient,
): Promise<MonitoredUrl[]> {
  const urls: MonitoredUrl[] = [];
  for (const orgId of await organizationIds(client)) {
    let projects: Project[];
    try {
      projects = await client.request<Project[]>(
        'GET',
        `/v2/organizations/${orgId}/projects`,
      );
    } catch (err) {
      // An API key is scoped to one organization, but the organization list
      // can include others its creator belongs to; those answer 404.
      if (err instanceof ApiError && err.statusCode === 404) {
        continue;
      }
      throw err;
    }
    for (const project of projects) {
      urls.push(
        ...(await client.request<MonitoredUrl[]>(
          'GET',
          `/v2/projects/${project.id}/monitored-urls`,
        )),
      );
    }
  }
  return urls;
}

export async function resolveMonitoredUrl(
  client: ApiClient,
  target: TargetOpts,
): Promise<MonitoredUrl> {
  if (target.urlId) {
    return client.request<MonitoredUrl>(
      'GET',
      `/v2/monitored-urls/${target.urlId}`,
    );
  }
  const wanted = normalizeUrl(target.url ?? '');
  const matches = (await listMonitoredUrls(client)).filter(
    (u) => normalizeUrl(u.url) === wanted,
  );
  if (matches.length === 0) {
    throw new ApiError(
      `No monitored URL matches ${target.url}. Add it on 37audits.com first, or pass --url-id.`,
      'url_not_found',
    );
  }
  if (matches.length > 1) {
    throw new ApiError(
      `${matches.length} monitored URLs match ${target.url}; pass --url-id with one of: ${matches.map((m) => m.id).join(', ')}.`,
      'ambiguous_target',
    );
  }
  return matches[0];
}

export async function resolveProjectId(
  client: ApiClient,
  opts: ProjectTargetOpts,
): Promise<string> {
  if (opts.project) {
    return opts.project;
  }
  return (await resolveMonitoredUrl(client, opts)).projectId;
}
