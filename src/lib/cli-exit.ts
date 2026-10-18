import { errorMessage, outputError } from './output';

export const CANCEL_EXIT_CODE = 130;

function sigintHandler(): void {
  if (process.stderr.isTTY) {
    process.stderr.write('\r\x1B[2K');
  }
  console.error('Cancelled.');
  process.exit(CANCEL_EXIT_CODE);
}

export function setupCliExitHandler(): void {
  process.on('SIGINT', sigintHandler);

  process.on('uncaughtException', (err: unknown) => {
    outputError({
      message: errorMessage(err, 'An unexpected error occurred'),
      code: 'unexpected_error',
    });
  });
}
