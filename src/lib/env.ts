export const DEFAULT_API_BASE_URL = 'https://api.37audits.com';

/** Supabase Auth of the production 37 Audits project: the OAuth 2.1 server. */
export const DEFAULT_AUTH_URL =
  'https://walqrrhzypvzyrfjmygm.supabase.co/auth/v1';

/**
 * The "37 Audits CLI" public OAuth client registered on the production
 * authorization server (Supabase dashboard > Authentication > OAuth Apps).
 * Public clients have no secret, so this id is not sensitive. Empty until the
 * client is registered; `login` then explains how to set it.
 */
export const DEFAULT_OAUTH_CLIENT_ID = '';

/** Loopback ports registered as redirect URIs, tried in order. */
export const CALLBACK_PORTS: readonly number[] = [37371, 37372, 37373];

export const CALLBACK_PATH = '/callback';

export const OAUTH_SCOPE = 'openid email profile offline_access';

export const ENV = {
  apiKey: 'THIRTYSEVENAUDITS_API_KEY',
  apiBaseUrl: 'THIRTYSEVENAUDITS_API_BASE_URL',
  authUrl: 'THIRTYSEVENAUDITS_AUTH_URL',
  oauthClientId: 'THIRTYSEVENAUDITS_OAUTH_CLIENT_ID',
} as const;

const trimSlash = (value: string): string => value.replace(/\/+$/, '');

export function apiBaseUrl(): string {
  return trimSlash(process.env[ENV.apiBaseUrl] || DEFAULT_API_BASE_URL);
}

export function authUrl(): string {
  return trimSlash(process.env[ENV.authUrl] || DEFAULT_AUTH_URL);
}

export function oauthClientId(): string {
  return process.env[ENV.oauthClientId] || DEFAULT_OAUTH_CLIENT_ID;
}

export function redirectUriFor(port: number): string {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`;
}
