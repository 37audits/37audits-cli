import { chmodSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { withFileLock } from './file-lock';
import { writeFileAtomic } from './write-file-atomic';

export type ApiKeyCredential = {
  type: 'api_key';
  api_key: string;
};

export type OAuthCredential = {
  type: 'oauth';
  /** The authorization server the tokens came from, kept so refreshes go back to it. */
  auth_url: string;
  client_id: string;
  access_token: string;
  /** Unix seconds, from the access token's exp claim. */
  access_token_expires_at: number;
  refresh_token: string;
};

export type Credential = ApiKeyCredential | OAuthCredential;

export interface CredentialsFile {
  version: 1;
  credential: Credential;
}

export function getConfigDir(): string {
  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, '37audits');
  }
  if (process.platform === 'win32' && process.env.APPDATA) {
    return join(process.env.APPDATA, '37audits');
  }
  return join(homedir(), '.config', '37audits');
}

export function getCredentialsPath(): string {
  return join(getConfigDir(), 'credentials.json');
}

export function getCredentialsLockPath(): string {
  return join(getConfigDir(), 'credentials.json.lock');
}

function isCredential(value: unknown): value is Credential {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const v = value as Record<string, unknown>;
  if (v.type === 'api_key') {
    return typeof v.api_key === 'string' && v.api_key.length > 0;
  }
  if (v.type === 'oauth') {
    return (
      typeof v.auth_url === 'string' &&
      typeof v.client_id === 'string' &&
      typeof v.access_token === 'string' &&
      typeof v.access_token_expires_at === 'number' &&
      typeof v.refresh_token === 'string'
    );
  }
  return false;
}

/**
 * Reads the credentials file. Returns null when there is none, throws when
 * the file exists but cannot be used (so the user learns to log in again
 * instead of silently acting unauthenticated).
 */
export function readCredentials(): CredentialsFile | null {
  const path = getCredentialsPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new Error(`Could not read ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `${path} is not valid JSON. Run \`37audits logout\` then \`37audits login\`.`,
    );
  }

  const file = parsed as Partial<CredentialsFile>;
  if (file?.version !== 1 || !isCredential(file.credential)) {
    throw new Error(
      `${path} has an unexpected format. Run \`37audits logout\` then \`37audits login\`.`,
    );
  }
  return { version: 1, credential: file.credential };
}

export function writeCredentials(file: CredentialsFile): string {
  const path = getCredentialsPath();
  mkdirSync(getConfigDir(), { recursive: true, mode: 0o700 });
  writeFileAtomic(path, `${JSON.stringify(file, null, 2)}\n`, 0o600);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Windows has no POSIX modes */
  }
  return path;
}

export function storeCredential(credential: Credential): string {
  return withFileLock(getCredentialsLockPath(), () =>
    writeCredentials({ version: 1, credential }),
  );
}

export function removeCredentials(): { path: string; removed: boolean } {
  const path = getCredentialsPath();
  return withFileLock(getCredentialsLockPath(), () => {
    try {
      unlinkSync(path);
      return { path, removed: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { path, removed: false };
      }
      throw err;
    }
  });
}
