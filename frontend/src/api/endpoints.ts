import type { DashboardLayout } from "../layout/model";
import { request } from "./client";
import type {
  Activity,
  ActivityDetail,
  Entry,
  EntryInput,
  FitnessReport,
  Goal,
  IntensityReport,
  PlannedInput,
  PlannedSession,
  RecoveryMetrics,
  WeekMetrics,
  WeekPlan,
  WellnessSeries,
} from "./types";

export interface LayoutResponse {
  revision: number;
  layout: DashboardLayout | null;
  updated_at: string | null;
}

export const fetchLayout = (): Promise<LayoutResponse> => request("GET", "/api/layout");

export const putLayout = (
  baseRevision: number,
  layout: DashboardLayout,
  keepalive = false,
): Promise<LayoutResponse> =>
  request("PUT", "/api/layout", { body: { base_revision: baseRevision, layout }, keepalive });

export type SourceState = "ok" | "degraded" | "auth_required" | "down" | "jamais_synchronise";

export interface SourceHealth {
  source: string;
  label: string;
  state: SourceState;
  message: string | null;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  unavailable_since: string | null;
  badge: string | null;
}

export const fetchSources = (): Promise<SourceHealth[]> => request("GET", "/api/sources/health");

export interface SyncStatus {
  running: boolean;
  nightly_time: string;
  next_run_at: string | null;
}

export const fetchSyncStatus = (): Promise<SyncStatus> => request("GET", "/api/sync/status");

export const runSync = (): Promise<{ started: boolean }> => request("POST", "/api/sync/run");

export interface GarminLoginResponse {
  status: "ok" | "mfa_required";
  ticket: string | null;
}

export const garminLogin = (
  body: { email: string; password: string } | { ticket: string; mfa_code: string },
): Promise<GarminLoginResponse> => request("POST", "/api/garmin/login", { body });

// --- métriques, programme, saisies, sorties ----------------------------------------------------

export const search = (params: Record<string, string | number | boolean | undefined>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : "";
};

export const fetchPlanWeek = (date?: string): Promise<WeekPlan> =>
  request("GET", `/api/plan/week${search({ date })}`);

export const createPlanSession = (body: PlannedInput): Promise<PlannedSession> =>
  request("POST", "/api/plan/sessions", { body });

export const updatePlanSession = (id: number, body: PlannedInput): Promise<PlannedSession> =>
  request("PUT", `/api/plan/sessions/${id}`, { body });

export const deletePlanSession = (id: number): Promise<null> =>
  request("DELETE", `/api/plan/sessions/${id}`);

export const fetchEntries = (from: string, to: string): Promise<Entry[]> =>
  request("GET", `/api/entries${search({ from, to })}`);

export const putEntry = (day: string, body: EntryInput): Promise<Entry> =>
  request("PUT", `/api/entries/${day}`, { body });

export const fetchWeekMetrics = (date?: string): Promise<WeekMetrics> =>
  request("GET", `/api/metrics/week${search({ date })}`);

export const fetchIntensity = (weeks: number): Promise<IntensityReport> =>
  request("GET", `/api/metrics/intensity${search({ weeks })}`);

export const fetchFitness = (from: string, to: string): Promise<FitnessReport> =>
  request("GET", `/api/metrics/fitness${search({ from, to })}`);

export const fetchRecovery = (days: number): Promise<RecoveryMetrics> =>
  request("GET", `/api/metrics/recovery${search({ days })}`);

export const fetchWellness = (days: number): Promise<WellnessSeries> =>
  request("GET", `/api/metrics/wellness${search({ days })}`);

export interface ActivityFilters {
  from?: string;
  to?: string;
  limit?: number;
  group?: "all" | "run" | "trail" | "other";
  races_only?: boolean;
}

export const fetchActivities = (filters: ActivityFilters = {}): Promise<Activity[]> =>
  request("GET", `/api/activities${search({ ...filters })}`);

export const fetchActivity = (id: number): Promise<ActivityDetail> =>
  request("GET", `/api/activities/${id}`);

export const fetchGoals = (): Promise<Goal[]> => request("GET", "/api/goals");

// --- export « Copier pour Claude » ------------------------------------------------------------

export interface ExportPeriod {
  from: string;
  to: string;
}

/** Markdown de l'export global (texte brut, jamais interprété). */
export const fetchExportMarkdown = (period: ExportPeriod): Promise<string> =>
  request("GET", `/api/export${search({ from: period.from, to: period.to })}`);

/** Liens de téléchargement : export complet (JSON) et flux de séance sous-échantillonnés. */
export const exportJsonUrl = (period: ExportPeriod): string =>
  `/api/export${search({ from: period.from, to: period.to, format: "json" })}`;

export const exportStreamsUrl = (period: ExportPeriod): string =>
  `/api/export/streams${search({ from: period.from, to: period.to })}`;

export const fetchActivityExport = (id: number): Promise<string> => request("GET", `/api/export/activity/${id}`);

// --- sauvegardes ------------------------------------------------------------------------------

export interface BackupStatus {
  backup_dir: string;
  last_run_at: string | null;
  /** `null` : aucune sauvegarde tentée. */
  ok: boolean | null;
  message: string;
  file: string | null;
  size_bytes: number | null;
  integrity: string | null;
  daily: number;
  weekly: number;
  monthly: number;
  total_size_bytes: number;
  /** Dernière sauvegarde absente, en échec ou vieille de plus de 36 h. */
  stale: boolean;
  warning: string | null;
}

export const fetchBackupStatus = (): Promise<BackupStatus> => request("GET", "/api/backup/status");
