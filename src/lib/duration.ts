const UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
};

/**
 * Parses "120s", "5m", "2h", "500ms" or a bare number of seconds into
 * milliseconds. Throws on anything else.
 */
export function parseDuration(value: string): number {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\s*$/i.exec(value);
  if (!match) {
    throw new Error(
      `Invalid duration "${value}". Use a number with a unit, e.g. 30s, 5m, 2h.`,
    );
  }
  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  return Math.round(amount * UNITS[unit]);
}

export function formatDuration(ms: number): string {
  if (ms % 3_600_000 === 0) {
    return `${ms / 3_600_000}h`;
  }
  if (ms % 60_000 === 0) {
    return `${ms / 60_000}m`;
  }
  return `${Math.round(ms / 1000)}s`;
}
