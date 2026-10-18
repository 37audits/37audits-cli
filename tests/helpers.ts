import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type MockInstance, vi } from 'vitest';

export class ExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

export function setNonInteractive(): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    value: undefined,
    writable: true,
  });
  Object.defineProperty(process.stdout, 'isTTY', {
    value: undefined,
    writable: true,
  });
}

export function mockExitThrow(): MockInstance {
  return vi.spyOn(process, 'exit').mockImplementation((code?: unknown) => {
    throw new ExitError(typeof code === 'number' ? code : 0);
  });
}

/**
 * Captures env and TTY state and points XDG_CONFIG_HOME at a fresh temp dir.
 * Call once at the top of a describe block; invoke the returned function in
 * afterEach.
 */
export function captureTestEnv(): () => void {
  const originalEnv = { ...process.env };
  const originalStdinIsTTY = process.stdin.isTTY;
  const originalStdoutIsTTY = process.stdout.isTTY;
  const configHome = mkdtempSync(join(tmpdir(), '37audits-cli-test-'));
  process.env.XDG_CONFIG_HOME = configHome;
  return () => {
    process.env = { ...originalEnv, XDG_CONFIG_HOME: configHome };
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalStdinIsTTY,
      writable: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalStdoutIsTTY,
      writable: true,
    });
    rmSync(configHome, { recursive: true, force: true });
  };
}

/** Non-interactive mode plus spies on stdout/stderr output. */
export function setupOutputSpies() {
  setNonInteractive();
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const stderrSpy = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  return { logSpy, errorSpy, stderrSpy };
}

export function lastJson(spy: MockInstance): unknown {
  const calls = spy.mock.calls;
  return JSON.parse(String(calls[calls.length - 1][0]));
}

export function lastError(spy: MockInstance): {
  message: string;
  code: string;
} {
  return (lastJson(spy) as { error: { message: string; code: string } }).error;
}

export async function expectExitCode(
  code: number,
  fn: () => Promise<unknown>,
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    expect(err).toBeInstanceOf(ExitError);
    expect((err as ExitError).code).toBe(code);
  }
  if (!threw) {
    throw new Error(
      `Expected the command to exit with code ${code} but it completed`,
    );
  }
}

export const expectExit1 = (fn: () => Promise<unknown>) =>
  expectExitCode(1, fn);

export type Route = {
  method?: string;
  path: string | RegExp;
  status?: number;
  body?: unknown;
  /** Called with the request; may return a body or a full {status, body}. */
  handler?: (
    url: URL,
    init: RequestInit,
  ) => unknown | { status: number; body?: unknown };
};

export type RecordedRequest = { method: string; url: URL; init: RequestInit };

/**
 * Replaces global fetch with a tiny router. Unmatched requests answer 404 so
 * a typo in a test shows up as a not_found error rather than a hang.
 */
export function mockFetch(routes: Route[]) {
  const requests: RecordedRequest[] = [];
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init = {}) => {
      const url = new URL(String(input));
      const method = (init.method ?? 'GET').toUpperCase();
      requests.push({ method, url, init });
      const route = routes.find(
        (r) =>
          (r.method ?? 'GET').toUpperCase() === method &&
          (typeof r.path === 'string'
            ? r.path === url.pathname
            : r.path.test(url.pathname)),
      );
      if (!route) {
        return jsonResponse(404, {
          title: 'Not Found',
          detail: `no route for ${method} ${url.pathname}`,
        });
      }
      let status = route.status ?? 200;
      let body = route.body;
      if (route.handler) {
        const result = route.handler(url, init) as
          | { status: number; body?: unknown }
          | unknown;
        if (
          typeof result === 'object' &&
          result !== null &&
          'status' in result &&
          typeof (result as { status: unknown }).status === 'number'
        ) {
          status = (result as { status: number }).status;
          body = (result as { body?: unknown }).body;
        } else {
          body = result;
        }
      }
      return jsonResponse(status, body);
    });
  return { spy, requests };
}

export function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

export const nowSeconds = () => Math.floor(Date.now() / 1000);
