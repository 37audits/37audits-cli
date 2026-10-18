import pc from 'picocolors';
import { isInteractive, isUnicodeSupported } from './tty';

// Symbols come from String.fromCodePoint() rather than literal Unicode so a
// mis-encoded bundle cannot corrupt them.
const TICK = isUnicodeSupported ? String.fromCodePoint(0x2714) : 'v';
const WARN = isUnicodeSupported ? String.fromCodePoint(0x26a0) : '!';
const CROSS = isUnicodeSupported ? String.fromCodePoint(0x2717) : 'x';

const SPINNER_FRAMES = [
  0x2839, 0x2838, 0x2834, 0x2826, 0x2807, 0x280f, 0x2819, 0x2839,
].map((c) => String.fromCodePoint(c));
const SPINNER_INTERVAL = 80;

export interface Spinner {
  update(msg: string): void;
  stop(msg?: string): void;
  warn(msg: string): void;
  fail(msg: string): void;
}

export function createSpinner(message: string, quiet?: boolean): Spinner {
  if (quiet || !isInteractive()) {
    return {
      update() {},
      stop() {},
      warn() {},
      fail() {},
    };
  }

  const frames = isUnicodeSupported ? SPINNER_FRAMES : ['-', '\\', '|', '/'];
  let i = 0;
  let text = message;

  const timer = setInterval(() => {
    process.stderr.write(`\r\x1B[2K  ${frames[i++ % frames.length]} ${text}`);
  }, SPINNER_INTERVAL);

  return {
    update(msg) {
      text = msg;
    },
    stop(msg) {
      clearInterval(timer);
      if (msg) {
        process.stderr.write(`\r\x1B[2K  ${pc.green(TICK)} ${msg}\n`);
      } else {
        process.stderr.write('\r\x1B[2K');
      }
    },
    warn(msg) {
      clearInterval(timer);
      process.stderr.write(`\r\x1B[2K  ${pc.yellow(WARN)} ${msg}\n`);
    },
    fail(msg) {
      clearInterval(timer);
      process.stderr.write(`\r\x1B[2K  ${pc.red(CROSS)} ${msg}\n`);
    },
  };
}
