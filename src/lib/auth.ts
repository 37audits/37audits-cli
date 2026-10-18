import { type OAuthCredential, readCredentials } from './config';
import { ENV } from './env';
import { ensureFreshOAuthCredential } from './oauth';

export type AuthSource = 'flag' | 'env' | 'config';

export type ResolvedAuth =
  | { type: 'api_key'; key: string; source: AuthSource }
  | { type: 'oauth'; credential: OAuthCredential; source: 'config' };

/**
 * Credential precedence: --api-key flag, THIRTYSEVENAUDITS_API_KEY, then the
 * credentials file. A stored OAuth session is refreshed when it is about to
 * expire unless `refresh: false`.
 */
export async function resolveAuthentication(
  flagValue?: string,
  options: { refresh?: boolean } = {},
): Promise<ResolvedAuth | null> {
  const flag = flagValue?.trim();
  if (flag) {
    return { type: 'api_key', key: flag, source: 'flag' };
  }

  const envKey = process.env[ENV.apiKey]?.trim();
  if (envKey) {
    return { type: 'api_key', key: envKey, source: 'env' };
  }

  const stored = readCredentials();
  if (!stored) {
    return null;
  }
  if (stored.credential.type === 'api_key') {
    return {
      type: 'api_key',
      key: stored.credential.api_key,
      source: 'config',
    };
  }

  const credential =
    options.refresh === false
      ? stored.credential
      : await ensureFreshOAuthCredential(stored.credential);
  return { type: 'oauth', credential, source: 'config' };
}

export function authHeaders(auth: ResolvedAuth): Record<string, string> {
  return auth.type === 'api_key'
    ? { 'x-api-key': auth.key }
    : { Authorization: `Bearer ${auth.credential.access_token}` };
}

export function maskSecret(value: string): string {
  if (value.length <= 12) {
    return `${value.slice(0, 4)}…`;
  }
  return `${value.slice(0, 9)}…${value.slice(-4)}`;
}
