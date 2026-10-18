import { type ApiClient, ApiError, sleep } from './api';
import type { AuditorResult, Page } from './types';

export interface WaitOptions {
  urlId: string;
  groupId: string;
  /** Absolute time in ms after which polling stops. */
  deadline: number;
  intervalMs: number;
  onTick?: (pending: number, total: number, secondsLeft: number) => void;
  onError?: (message: string) => void;
}

export interface WaitResult {
  results: AuditorResult[];
  pending: number;
  timedOut: boolean;
}

/** A run group holds one result per auditor (~60 today); one page covers it. */
const GROUP_PAGE_SIZE = 100;

/**
 * Polls a run group until no result is pending. Transient API failures are
 * reported through `onError` and polling continues until the deadline.
 */
export async function waitForGroup(
  client: ApiClient,
  options: WaitOptions,
): Promise<WaitResult> {
  let results: AuditorResult[] = [];
  let pending = 0;

  for (;;) {
    try {
      const page = await client.request<Page<AuditorResult>>(
        'GET',
        `/v2/monitored-urls/${options.urlId}/audit-results`,
        { query: { groupId: options.groupId, size: GROUP_PAGE_SIZE } },
      );
      results = page.content ?? [];
      pending = results.filter((r) => r.status === 'pending').length;
      if (results.length > 0 && pending === 0) {
        return { results, pending: 0, timedOut: false };
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'network_error' || err.code === 'server_error')
      ) {
        options.onError?.(err.message);
      } else {
        throw err;
      }
    }

    const remaining = options.deadline - Date.now();
    if (remaining <= 0) {
      return { results, pending, timedOut: true };
    }
    options.onTick?.(
      pending,
      results.length,
      Math.max(0, Math.round(remaining / 1000)),
    );
    await sleep(Math.min(options.intervalMs, remaining));
  }
}
