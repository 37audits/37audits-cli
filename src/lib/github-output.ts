import { appendFileSync } from 'node:fs';

/**
 * Appends `key=value` to the file GitHub Actions names in $GITHUB_OUTPUT so a
 * later step can read `steps.<id>.outputs.<key>`. A no-op outside Actions.
 */
export function appendGithubOutput(key: string, value: string): boolean {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    return false;
  }
  appendFileSync(file, `${key}=${value}\n`);
  return true;
}
