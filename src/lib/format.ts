import pc from 'picocolors';
import { renderTable } from './table';
import type { AuditorResult, CheckStatus, MaintenanceWindow } from './types';

export function colorStatus(status: CheckStatus | string): string {
  switch (status) {
    case 'success':
      return pc.green(status);
    case 'fail':
    case 'error':
      return pc.red(status);
    case 'warning':
      return pc.yellow(status);
    case 'information':
      return pc.blue(status);
    case 'pending':
      return pc.dim(status);
    default:
      return status;
  }
}

export function colorWindowStatus(status: MaintenanceWindow['status']): string {
  switch (status) {
    case 'active':
      return pc.yellow(status);
    case 'scheduled':
      return pc.blue(status);
    default:
      return pc.dim(status);
  }
}

export function formatDate(value?: string | null): string {
  if (!value) {
    return '-';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, 'Z');
}

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

export function resultsTable(results: AuditorResult[]): string {
  const rows = [...results]
    .sort((a, b) =>
      (a.auditorName ?? a.auditorId).localeCompare(
        b.auditorName ?? b.auditorId,
      ),
    )
    .map((r) => [
      r.auditorName ?? r.auditorId,
      colorStatus(r.status),
      truncate((r.message ?? '').replace(/\s+/g, ' '), 70),
    ]);
  return renderTable(['Auditor', 'Status', 'Message'], rows);
}

export function summarizeStatuses(results: AuditorResult[]): string {
  const counts = new Map<string, number>();
  for (const r of results) {
    counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  }
  return ['success', 'warning', 'fail', 'error', 'information', 'pending']
    .filter((s) => counts.has(s))
    .map((s) => `${counts.get(s)} ${colorStatus(s)}`)
    .join(', ');
}

export function windowsTable(windows: MaintenanceWindow[]): string {
  const rows = windows.map((w) => [
    w.id,
    colorWindowStatus(w.status),
    formatDate(w.startsAt),
    w.endsAt ? formatDate(w.endsAt) : 'open-ended',
    truncate(w.reason ?? '', 50),
    w.createdBy?.displayName ?? w.createdBy?.email ?? '-',
  ]);
  return renderTable(
    ['ID', 'Status', 'Starts', 'Ends', 'Reason', 'By'],
    rows,
    '(no maintenance windows)',
  );
}
