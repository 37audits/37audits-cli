import { ApiError, type GlobalOpts } from './api';
import { OAuthError } from './oauth';
import { errorMessage, outputError, outputResult } from './output';
import { deepSanitize } from './safe-terminal-text';
import { createSpinner } from './spinner';
import { isInteractive } from './tty';

export function globalOptsOf(cmd: { optsWithGlobals(): object }): GlobalOpts {
  return cmd.optsWithGlobals() as GlobalOpts;
}

export function wantsHuman(globalOpts: GlobalOpts): boolean {
  return !globalOpts.json && isInteractive();
}

/**
 * Runs an API call behind a spinner and turns its failures into the CLI's
 * error envelope. API errors keep their own code; anything else gets
 * `fallbackCode`.
 */
export async function withSpinnerCall<T>(
  globalOpts: GlobalOpts,
  loading: string,
  call: () => Promise<T>,
  fallbackCode = 'unexpected_error',
): Promise<T> {
  const spinner = createSpinner(loading, globalOpts.quiet);
  try {
    const data = await call();
    spinner.stop();
    return data;
  } catch (err) {
    spinner.stop();
    if (err instanceof ApiError) {
      return outputError(
        { message: err.message, code: err.code, statusCode: err.statusCode },
        { json: globalOpts.json },
      );
    }
    if (err instanceof OAuthError) {
      return outputError(
        { message: err.message, code: err.code },
        { json: globalOpts.json },
      );
    }
    return outputError(
      { message: errorMessage(err, 'Unknown error'), code: fallbackCode },
      { json: globalOpts.json },
    );
  }
}

/** Prints `data` for a human when interactive, otherwise as JSON. */
export function emit<T>(
  globalOpts: GlobalOpts,
  data: T,
  onInteractive: (data: T) => void,
): void {
  if (wantsHuman(globalOpts)) {
    onInteractive(deepSanitize(data));
  } else {
    outputResult(data, { json: globalOpts.json });
  }
}

export function fail(
  globalOpts: GlobalOpts,
  message: string,
  code: string,
): never {
  return outputError({ message, code }, { json: globalOpts.json });
}
