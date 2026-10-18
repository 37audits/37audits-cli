import { randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';

export function writeFileAtomic(
  filePath: string,
  data: string,
  mode: number,
): void {
  const tmpPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;

  try {
    const fd = openSync(tmpPath, 'w', mode);
    try {
      writeSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmpPath, filePath);
    fsyncDir(dirname(filePath));
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch {
      /* cleanup is best-effort */
    }
    throw err;
  }
}

// POSIX only guarantees the rename survives a crash once the parent directory
// is fsynced too. Windows cannot fsync a directory, so skip it there.
function fsyncDir(dirPath: string): void {
  if (process.platform === 'win32') {
    return;
  }
  try {
    const dirFd = openSync(dirPath, 'r');
    try {
      fsyncSync(dirFd);
    } finally {
      closeSync(dirFd);
    }
  } catch {
    /* best-effort: some filesystems refuse dir fsync */
  }
}
