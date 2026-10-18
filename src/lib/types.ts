export type CheckStatus =
  | 'success'
  | 'fail'
  | 'warning'
  | 'information'
  | 'error'
  | 'pending';

/** One entry of the 202 response of POST .../audit-results/run. */
export interface AuditRunResult {
  id: string;
  urlId: string;
  auditor: { id: string; name: string; version?: string | null };
  status: CheckStatus;
  groupId: string;
  message?: string | null;
  date?: string;
}

/** One stored auditor result (GET .../audit-results and .../latest). */
export interface AuditorResult {
  id: string;
  urlId: string;
  auditorId: string;
  auditorName?: string | null;
  auditorVersion?: string | null;
  status: CheckStatus;
  message?: string | null;
  groupId?: string | null;
  createdAt: string;
  responseTime?: number | null;
  maintenanceWindowId?: string | null;
  checks?: unknown[];
}

export interface Page<T> {
  content: T[];
  page: {
    size: number;
    number: number;
    totalElements: number;
    totalPages: number;
  };
}

export interface MonitoredUrl {
  id: string;
  projectId: string;
  url: string;
  label?: string | null;
  status: 'draft' | 'active' | 'disabled';
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
}

export interface MaintenanceRun {
  monitoredUrlId: string;
  groupId: string;
}

export interface Actor {
  id: string;
  displayName?: string | null;
  email?: string | null;
}

export interface MaintenanceWindow {
  id: string;
  projectId: string;
  reason?: string | null;
  startsAt: string;
  endsAt?: string | null;
  leadMinutes: number;
  status: 'scheduled' | 'active' | 'ended';
  preRunAt?: string | null;
  postRunAt?: string | null;
  createdBy?: Actor | null;
  updatedBy?: Actor | null;
  createdAt: string;
  updatedAt: string;
  /** Present on start/end responses: one entry per URL whose auditors ran. */
  runs?: MaintenanceRun[];
}

export interface Me {
  userId: string;
  email?: string | null;
  displayName?: string | null;
  authKind: 'user' | 'api_key';
  apiKey?: {
    id: string;
    name?: string | null;
    role: string;
    organizationId: string;
    organizationName?: string | null;
  } | null;
}
