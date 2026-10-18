import { execFile } from 'node:child_process';

/**
 * Try to open a URL in the user's default browser. Resolves false on error or
 * when the terminal has no browser (e.g. over SSH).
 */
export function openInBrowser(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd =
      process.platform === 'win32'
        ? 'cmd.exe'
        : process.platform === 'darwin'
          ? 'open'
          : 'xdg-open';
    const safeUrl = url.replaceAll('"', '');
    const args =
      process.platform === 'win32'
        ? ['/c', 'start', '""', `"${safeUrl}"`]
        : [url];
    execFile(
      cmd,
      args,
      { timeout: 5000, windowsVerbatimArguments: true },
      (err) => resolve(!err),
    );
  });
}
