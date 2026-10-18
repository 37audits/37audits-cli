import { safeTerminalText } from './safe-terminal-text';
import { isUnicodeSupported } from './tty';

const BOX = isUnicodeSupported
  ? {
      h: String.fromCodePoint(0x2500),
      v: String.fromCodePoint(0x2502),
      tl: String.fromCodePoint(0x250c),
      tr: String.fromCodePoint(0x2510),
      bl: String.fromCodePoint(0x2514),
      br: String.fromCodePoint(0x2518),
      lm: String.fromCodePoint(0x251c),
      rm: String.fromCodePoint(0x2524),
      tm: String.fromCodePoint(0x252c),
      bm: String.fromCodePoint(0x2534),
      mm: String.fromCodePoint(0x253c),
    }
  : {
      h: '-',
      v: '|',
      tl: '+',
      tr: '+',
      bl: '+',
      br: '+',
      lm: '+',
      rm: '+',
      tm: '+',
      bm: '+',
      mm: '+',
    };

// biome-ignore lint/suspicious/noControlCharactersInRegex: measures visible width, so ANSI colour codes are removed first
const ANSI = /\x1B\[[0-9;]*m/g;

const visibleLength = (s: string): number => s.replace(ANSI, '').length;

const padEnd = (s: string, width: number): string =>
  s + ' '.repeat(Math.max(0, width - visibleLength(s)));

function renderCards(headers: string[], rows: string[][]): string {
  const labelWidth = Math.max(...headers.map((h) => h.length));
  return rows
    .map((row, idx) => {
      const label = String(idx + 1);
      const sep = `${BOX.h}${BOX.h} ${label} ${BOX.h.repeat(Math.max(0, 56 - label.length))}`;
      const fields = headers.map(
        (h, i) => `  ${h.padEnd(labelWidth)}  ${row[i]}`,
      );
      return [sep, ...fields].join('\n');
    })
    .join('\n\n');
}

/**
 * Renders a boxed table, or one card per row when the table would be wider
 * than the terminal. Cells may contain ANSI colours.
 */
export function renderTable(
  headers: string[],
  rows: string[][],
  emptyMessage = '(no results)',
): string {
  if (rows.length === 0) {
    return emptyMessage;
  }
  const cells = rows.map((r) => r.map(safeTerminalText));
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((r) => visibleLength(r[i]))),
  );

  const termWidth = process.stdout.columns;
  if (termWidth !== undefined) {
    const totalWidth =
      widths.reduce((s, w) => s + w, 0) + 3 * widths.length + 1;
    if (totalWidth > termWidth) {
      return renderCards(headers, cells);
    }
  }

  const line = (l: string, m: string, r: string) =>
    l + widths.map((w) => BOX.h.repeat(w + 2)).join(m) + r;
  const row = (c: string[]) =>
    `${BOX.v} ${c.map((v, i) => padEnd(v, widths[i])).join(` ${BOX.v} `)} ${BOX.v}`;
  return [
    line(BOX.tl, BOX.tm, BOX.tr),
    row(headers),
    line(BOX.lm, BOX.mm, BOX.rm),
    ...cells.map(row),
    line(BOX.bl, BOX.bm, BOX.br),
  ].join('\n');
}
