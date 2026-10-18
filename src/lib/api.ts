import { authHeaders, type ResolvedAuth, resolveAuthentication } from './auth';
import { apiBaseUrl, ENV } from './env';
import { ensureFreshOAuthCredential, OAuthError } from './oauth';
import { outputError } from './output';
import { VERSION } from './version';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface GlobalOpts {
  apiKey?: string;
  json?: boolean;
  quiet?: boolean;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
  query?: Record<string, QueryValue | QueryValue[]>;
  body?: unknown;
  /** Retry 429/502/503/504 and network failures. Defaults to true for GET. */
  retry?: boolean;
  timeoutMs?: number;
}

export const REQUEST_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function codeForStatus(status: number): string {
  switch (status) {
    case 401:
      return 'auth_error';
    case 402:
      return 'insufficient_credits';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    default:
      return status >= 500 ? 'server_error' : 'request_error';
  }
}

/** Spring's ProblemDetail: {type, title, status, detail}. */
function problemMessage(body: unknown, text: string, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const b = body as Record<string, unknown>;
    for (const key of ['detail', 'message', 'title', 'error']) {
      if (typeof b[key] === 'string' && (b[key] as string).trim()) {
        return b[key] as string;
      }
    }
  }
  const trimmed = text.trim();
  return trimmed && trimmed.length <= 300 ? trimmed : `HTTP ${status}`;
}

export class ApiClient {
  constructor(
    private auth: ResolvedAuth,
    readonly baseUrl: string = apiBaseUrl(),
  ) {}

  get authKind(): ResolvedAuth['type'] {
    return this.auth.type;
  }

  get authSource(): ResolvedAuth['source'] {
    return this.auth.source;
  }

  get credential(): ResolvedAuth {
    return this.auth;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      for (const v of Array.isArray(value) ? value : [value]) {
        if (v !== undefined && v !== null) {
          url.searchParams.append(key, String(v));
        }
      }
    }

    const retry = options.retry ?? method === 'GET';
    let attempt = 0;
    let refreshed = false;

    for (;;) {
      const headers: Record<string, string> = {
        ...authHeaders(this.auth),
        Accept: 'application/json',
        'User-Agent': `37audits-cli/${VERSION}`,
      };
      const init: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      };
      if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      }

      let response: Response;
      try {
        response = await fetch(url, init);
      } catch (err) {
        if (retry && attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt++]);
          continue;
        }
        const timedOut = err instanceof Error && err.name === 'TimeoutError';
        throw new ApiError(
          timedOut
            ? `Request to ${url.host} timed out after ${(options.timeoutMs ?? REQUEST_TIMEOUT_MS) / 1000}s.`
            : `Could not reach ${url.host}: ${(err as Error).message}`,
          'network_error',
        );
      }

      if (response.status === 401 && this.auth.type === 'oauth' && !refreshed) {
        refreshed = true;
        try {
          const credential = await ensureFreshOAuthCredential(
            this.auth.credential,
            { force: true },
          );
          this.auth = { type: 'oauth', credential, source: 'config' };
          continue;
        } catch (err) {
          if (err instanceof OAuthError) {
            throw new ApiError(err.message, err.code, 401);
          }
          throw err;
        }
      }

      if (
        retry &&
        RETRYABLE_STATUSES.has(response.status) &&
        attempt < RETRY_DELAYS_MS.length
      ) {
        await sleep(RETRY_DELAYS_MS[attempt++]);
        continue;
      }

      const text = await response.text();
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        body = undefined;
      }

      if (!response.ok) {
        const code = codeForStatus(response.status);
        let message = problemMessage(body, text, response.status);
        if (response.status === 401) {
          message =
            this.auth.type === 'api_key'
              ? `The API key was rejected (${this.auth.source === 'env' ? ENV.apiKey : this.auth.source}). Check it or run \`37audits login\`.`
              : 'Your session was rejected. Run `37audits login` to sign in again.';
        }
        throw new ApiError(message, code, response.status, body);
      }

      return body as T;
    }
  }
}

/** The client for the current credentials, or a `not_authenticated` exit. */
export async function requireClient(
  globalOpts: GlobalOpts,
): Promise<ApiClient> {
  let auth: ResolvedAuth | null;
  try {
    auth = await resolveAuthentication(globalOpts.apiKey);
  } catch (err) {
    const code = err instanceof OAuthError ? err.code : 'auth_error';
    return outputError(
      { message: (err as Error).message, code },
      { json: globalOpts.json },
    );
  }
  if (!auth) {
    return outputError(
      {
        message: `Not authenticated. Run \`37audits login\`, pass --api-key, or set ${ENV.apiKey}.`,
        code: 'not_authenticated',
      },
      { json: globalOpts.json },
    );
  }
  return new ApiClient(auth);
}
