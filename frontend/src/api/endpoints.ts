import type { DashboardLayout } from "../layout/model";
import { request } from "./client";
import type {
  Activity,
  ActivityDetail,
  Entry,
  EntryInput,
  FatigueReport,
  FitnessReport,
  FuelingInput,
  FuelingSeries,
  Goal,
  GearReport,
  Plan,
  RangePlan,
  GpxSummary,
  MonotonyReport,
  RaceGoalReport,
  WeatherPlace,
  WeatherResponse,
  StrengthReport,
  IntensityReport,
  PlannedInput,
  WorkoutType,
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
  last_run: { trigger: string; started_at: string; results: { source: string; ok: boolean; inserted: number }[] } | null;
}

export const fetchSyncStatus = (): Promise<SyncStatus> => request("GET", "/api/sync/status");

export const runSync = (): Promise<{ started: boolean }> => request("POST", "/api/sync/run");

/** Vérification rapide : seulement les activités plus récentes que la dernière connue. */
export const checkSync = (): Promise<{ started: boolean }> => request("POST", "/api/sync/check");

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

/** Calendrier : un jour par entrée de `from` à `to` inclus (62 jours au plus). */
export const fetchPlanRange = (from: string, to: string): Promise<RangePlan> =>
  request("GET", `/api/plan/range${search({ from, to })}`);

export const createPlanSession = (body: PlannedInput): Promise<PlannedSession> =>
  request("POST", "/api/plan/sessions", { body });

export const updatePlanSession = (id: number, body: PlannedInput): Promise<PlannedSession> =>
  request("PUT", `/api/plan/sessions/${id}`, { body });

/** Corrige à la main le type d'une sortie ; `null` revient au type calculé. */
export const setWorkoutType = (activityId: number, type: WorkoutType | null): Promise<null> =>
  request("PUT", `/api/plan/activities/${activityId}/workout-type`, { body: { type } });

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

export type ExportFormat = "md" | "json" | "csv";

export const EXPORT_FORMATS: readonly { value: ExportFormat; label: string }[] = [
  { value: "md", label: "Markdown" },
  { value: "json", label: "JSON" },
  { value: "csv", label: "CSV (une série)" },
];

/** Séries disponibles en CSV (colonnes explicites, dates ISO). */
export const CSV_SERIES: readonly { value: string; label: string }[] = [
  { value: "activities", label: "Séances" },
  { value: "wellness", label: "Bien-être (HRV, FC repos, sommeil…)" },
  { value: "hrv", label: "HRV quotidienne" },
  { value: "load", label: "Charge (CTL / ATL / TSB)" },
  { value: "intensity", label: "Intensités par semaine" },
  { value: "monotony", label: "Monotonie et tension" },
  { value: "fatigue", label: "D− hebdomadaire" },
  { value: "strength", label: "Renforcement" },
  { value: "fueling", label: "Nutrition en course" },
  { value: "plan", label: "Plan prévu vs réalisé" },
  { value: "entries", label: "Saisies du soir" },
  { value: "gear", label: "Matériel (km par paire)" },
];

/** Lien de téléchargement de l'export global dans le format choisi. */
export const exportUrl = (period: ExportPeriod, format: ExportFormat, series = "activities"): string =>
  `/api/export${search({ from: period.from, to: period.to, format, series: format === "csv" ? series : undefined })}`;

/** Texte de l'export global (Markdown, CSV ; le JSON est remis en forme lisible). */
export const fetchExportText = async (period: ExportPeriod, format: ExportFormat, series = "activities"): Promise<string> => {
  const body = await request<unknown>("GET", exportUrl(period, format, series));
  return typeof body === "string" ? body : JSON.stringify(body, null, 2);
};

export const widgetExportUrl = (widgetId: string, format: ExportFormat): string =>
  `/api/export/widget/${encodeURIComponent(widgetId)}${search({ format })}`;

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

// --- phase 2 -----------------------------------------------------------------------------------

export const fetchRaceGoal = (goalId?: number | null): Promise<RaceGoalReport> =>
  request("GET", `/api/metrics/race-goal${search({ goal_id: goalId ?? undefined })}`);

export const setGoalProfile = (id: number, points: [number, number][]): Promise<Goal> =>
  request("PUT", `/api/goals/${id}/profile`, { body: { points } });

export const importGoalGpx = (id: number, gpx: string, applyTotals: boolean): Promise<GpxSummary> =>
  request("POST", `/api/goals/${id}/profile/gpx`, { body: { gpx, apply_totals: applyTotals } });

export const clearGoalProfile = (id: number): Promise<Goal> => request("DELETE", `/api/goals/${id}/profile`);

export const fetchFuelingSeries = (minHours?: number): Promise<FuelingSeries> =>
  request("GET", `/api/fueling/series${search({ min_hours: minHours })}`);

export const createFueling = (activityId: number, body: FuelingInput): Promise<unknown> =>
  request("POST", "/api/fueling", { body: { activity_id: activityId, ...body } });

export const updateFueling = (id: number, body: FuelingInput): Promise<unknown> =>
  request("PUT", `/api/fueling/${id}`, { body });

export const deleteFueling = (id: number): Promise<null> => request("DELETE", `/api/fueling/${id}`);

export const fetchMonotony = (weeks: number): Promise<MonotonyReport> =>
  request("GET", `/api/metrics/monotony${search({ weeks })}`);

export const fetchFatigue = (weeks: number): Promise<FatigueReport> =>
  request("GET", `/api/metrics/fatigue${search({ weeks })}`);

export const fetchStrength = (weeks: number): Promise<StrengthReport> =>
  request("GET", `/api/metrics/strength${search({ weeks })}`);

export const addStrengthSession = (date: string): Promise<unknown> =>
  request("POST", "/api/strength/sessions", { body: { date } });

export const fetchStrengthSessions = (from: string, to: string): Promise<{ id: number; date: string }[]> =>
  request("GET", `/api/strength/sessions${search({ from, to })}`);

export const setStrengthTarget = (target: number | null): Promise<unknown> =>
  request("PUT", "/api/profile", { body: { renfo_objectif_hebdo: target } });

// --- import de plan -----------------------------------------------------------------------------

export interface PlanLine {
  titre: string;
  type: string;
  type_label: string;
  objectif: string | null;
  duree_min: number | null;
  zone_cible: string | null;
  dplus_cible: number | null;
  consignes: string | null;
}

export interface PlanImportDay {
  date: string;
  action: "create" | "replace" | "unchanged" | "blocked" | "overlap";
  reason: string | null;
  existing: PlanLine[];
  incoming: PlanLine[];
}

export interface PlanImportInfo {
  nom: string;
  action: "create" | "update";
  plan_id: number | null;
  course_id: number | null;
  course_nom: string | null;
  course_asked: string | null;
  date_debut: string;
  date_fin: string;
}

export interface PlanImportReport {
  dry_run: boolean;
  applied: boolean;
  plan: PlanImportInfo | null;
  warnings: string[];
  summary: {
    sessions_in_file: number;
    days_in_file: number;
    created_days: number;
    replaced_days: number;
    unchanged_days: number;
    blocked_days: number;
    overlap_days: number;
    sessions_added: number;
    sessions_removed: number;
  };
  days: PlanImportDay[];
}

export interface PlanImportIssue {
  session: number | null;
  field: string | null;
  message: string;
}

export const importPlan = (
  doc: unknown,
  options: { dryRun: boolean; confirmPastDone?: boolean; confirmOverlap?: boolean },
): Promise<PlanImportReport> =>
  request(
    "POST",
    `/api/plan/import${search({
      dry_run: options.dryRun,
      confirm_past_done: options.confirmPastDone ?? false,
      confirm_overlap: options.confirmOverlap ?? false,
    })}`,
    { body: doc },
  );

// --- plans et courses ---------------------------------------------------------------------------

export const fetchPlans = (): Promise<Plan[]> => request("GET", "/api/plans");

/** Attribue le plan à une course, ou le détache (`null`). */
export const setPlanCourse = (planId: number, goalId: number | null): Promise<Plan> =>
  request("PUT", `/api/plans/${planId}/course`, { body: { goal_id: goalId } });

export const deletePlan = (planId: number): Promise<{ removed: number; kept: number }> =>
  request("DELETE", `/api/plans/${planId}`);

// --- Strava (optionnel) -------------------------------------------------------------------------

export interface StravaStatus {
  /** STRAVA_ENABLED vrai et identifiants présents. */
  enabled: boolean;
  requested: boolean;
  configured: boolean;
  connected: boolean;
  scope: string;
  redirect_uri: string;
  warning: string;
  limits: string;
}

export const fetchStravaStatus = (): Promise<StravaStatus> => request("GET", "/api/strava/status");
export const stravaAuthorize = (): Promise<{ url: string }> => request("POST", "/api/strava/authorize");
export const stravaDisconnect = (): Promise<null> => request("POST", "/api/strava/disconnect");

// --- matériel -----------------------------------------------------------------------------------

export const fetchGear = (): Promise<GearReport> => request("GET", "/api/gear");

export const createGear = (body: { nom: string; seuil_km: number; km_initial: number }): Promise<{ id: number }> =>
  request("POST", "/api/gear", { body });

export const updateGear = (
  id: number,
  body: { nom?: string; seuil_km?: number; km_initial?: number; retire?: boolean },
): Promise<null> => request("PUT", `/api/gear/${id}`, { body });

export const deleteGear = (id: number): Promise<null> => request("DELETE", `/api/gear/${id}`);

export const assignGear = (activityId: number, gearId: number | null): Promise<null> =>
  request("PUT", "/api/gear/assign/activity", { body: { activity_id: activityId, gear_id: gearId } });

// --- météo --------------------------------------------------------------------------------------

export const fetchWeather = (day: string): Promise<WeatherResponse> => request("GET", `/api/weather${search({ day })}`);
export const fetchWeatherLocation = (): Promise<WeatherPlace | null> => request("GET", "/api/weather/location");
export const geocodePlace = (q: string): Promise<WeatherPlace[]> => request("GET", `/api/weather/geocode${search({ q })}`);
export const setWeatherLocation = (place: WeatherPlace): Promise<WeatherPlace> =>
  request("PUT", "/api/weather/location", { body: place });

// --- import manuel FIT / GPX --------------------------------------------------------------------

export interface ImportedActivity {
  activity_id: number;
  created: boolean;
  sport: string;
  start_utc: string;
  duration_min: number;
  distance_km: number | null;
  dplus_m: number | null;
  hr_avg: number | null;
  has_stream: boolean;
  same_session_as: string[];
  warnings: string[];
}

export const importActivityFile = (file: File, sport: string | null): Promise<ImportedActivity> =>
  request("POST", `/api/import/activity${search({ filename: file.name, sport: sport ?? undefined })}`, { file });

// --- verrouillage simple (optionnel) ------------------------------------------------------------

export interface AuthStatus {
  locked: boolean;
  authenticated: boolean;
}

export const fetchAuthStatus = (): Promise<AuthStatus> => request("GET", "/api/auth/status");
export const login = (code: string): Promise<null> => request("POST", "/api/auth/login", { body: { code } });
export const logout = (): Promise<null> => request("POST", "/api/auth/logout");

export interface GoalInput {
  nom: string;
  date: string;
  distance_km?: number | null;
  dplus_m?: number | null;
  priorite?: number;
}

export const createGoal = (body: GoalInput): Promise<Goal> => request("POST", "/api/goals", { body });
export const updateGoal = (id: number, body: GoalInput): Promise<Goal> => request("PUT", `/api/goals/${id}`, { body });
export const deleteGoal = (id: number): Promise<null> => request("DELETE", `/api/goals/${id}`);
