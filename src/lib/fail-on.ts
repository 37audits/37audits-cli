export type FailOnLevel = 'fail' | 'warning';

export const FAIL_ON_EXIT_CODE = 2;

export function parseFailOn(value: string): FailOnLevel {
  if (value === 'fail' || value === 'warning') {
    return value;
  }
  throw new Error(`Invalid --fail-on "${value}". Use "fail" or "warning".`);
}

/** The result statuses that trip a --fail-on gate at the given level. */
export function gatedStatuses(level: FailOnLevel): ReadonlySet<string> {
  return level === 'warning'
    ? new Set(['fail', 'error', 'warning'])
    : new Set(['fail', 'error']);
}

export function countGated(
  results: ReadonlyArray<{ status: string }>,
  level: FailOnLevel,
): number {
  const gated = gatedStatuses(level);
  return results.filter((r) => gated.has(r.status)).length;
}
