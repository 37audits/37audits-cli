import pc from 'picocolors';

export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export interface OutputOptions {
  json?: boolean;
  exitCode?: number;
}

export interface ErrorOutput {
  message: string;
  code?: string;
  statusCode?: number | null;
}

export function shouldOutputJson(json?: boolean): boolean {
  if (json) {
    return true;
  }
  return !process.stdout.isTTY;
}

export function outputResult(data: unknown, opts: OutputOptions = {}): void {
  if (typeof data === 'string' && !shouldOutputJson(opts.json)) {
    console.log(data);
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
  if (opts.exitCode !== undefined) {
    process.exit(opts.exitCode);
  }
}

export function outputError(
  error: ErrorOutput,
  opts: OutputOptions = {},
): never {
  const exitCode = opts.exitCode ?? 1;

  if (shouldOutputJson(opts.json)) {
    const envelope: Record<string, unknown> = {
      message: error.message,
      code: error.code ?? 'unknown',
    };
    if (typeof error.statusCode === 'number') {
      envelope.statusCode = error.statusCode;
    }
    console.error(JSON.stringify({ error: envelope }, null, 2));
  } else {
    console.error(`${pc.red('Error:')} ${error.message}`);
    if (typeof error.statusCode === 'number') {
      console.error(pc.dim(`[HTTP ${error.statusCode}]`));
    }
  }

  process.exit(exitCode);
}

/** A warning that never changes the exit code; always goes to stderr. */
export function outputWarning(message: string, opts: OutputOptions = {}): void {
  if (shouldOutputJson(opts.json)) {
    console.error(JSON.stringify({ warning: { message } }));
  } else {
    console.error(`${pc.yellow('Warning:')} ${message}`);
  }
}
