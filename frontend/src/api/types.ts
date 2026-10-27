/** Réponses de l'API (reflet des modèles Pydantic du backend). */

export type EvidenceLevel = "etabli" | "indicatif" | "non_valide" | "avis_montre";

export interface Evidence {
  level: EvidenceLevel;
  summary: string;
}

export type Direction = "hausse" | "baisse" | "stable" | "indetermine";

export interface Trend {
  direction: Direction;
  delta: number | null;
  delta_pct: number | null;
  window: string;
}

// --- programme et saisies ---------------------------------------------------------------------

export type SessionType =
  | "footing"
  | "cotes"
  | "seuil"
  | "longue"
  | "fractionne"
  | "course"
  | "renfo"
  | "repos"
  | "autre";

export type PlanStatus = "fait" | "manqué" | "partiel" | "à venir" | "imprévu";

export interface PlannedInput {
  date: string;
  titre: string;
  type: SessionType;
  objectif: string | null;
  duree_min: number | null;
  zone_cible: string | null;
  dplus_cible: number | null;
  consignes: string | null;
}

export interface PlannedSession extends PlannedInput {
  id: number;
  type_label: string;
  status: PlanStatus;
  plan_id: number | null;
  plan_nom: string | null;
}

/** Plan d'entraînement nommé, éventuellement attribué à une course. */
export interface Plan {
  id: number;
  nom: string;
  date_debut: string;
  date_fin: string;
  goal_id: number | null;
  goal_nom: string | null;
  nb_seances: number;
}

export interface ActivityBrief {
  id: number;
  sport: string;
  start_utc: string;
  duration_min: number;
  distance_km: number | null;
  dplus_m: number | null;
  hr_avg: number | null;
  is_race: boolean;
}

export interface SessionMatch {
  planned: PlannedSession;
  status: PlanStatus;
  activity: ActivityBrief | null;
  duration_delta_min: number | null;
  duration_ratio: number | null;
  dplus_delta_m: number | null;
}

export interface SessionRpe {
  activity_id: number | null;
  rpe: number;
  sport: string | null;
  duration_min: number | null;
}

export interface Entry {
  date: string;
  courbatures: number | null;
  malade: boolean | null;
  note: string | null;
  sessions: SessionRpe[];
  updated_at: string | null;
}

export interface EntryInput {
  courbatures?: number | null;
  malade?: boolean | null;
  note?: string | null;
  sessions?: { activity_id: number; rpe: number | null }[];
}

export interface DayPlan {
  date: string;
  weekday: string;
  is_today: boolean;
  status: PlanStatus | null;
  sessions: SessionMatch[];
  unplanned_activities: ActivityBrief[];
  entry: Entry | null;
}

export interface WeekPlan {
  week_start: string;
  week_end: string;
  planned_min: number;
  done_min: number;
  days: DayPlan[];
}

// --- métriques ---------------------------------------------------------------------------------

export interface VolumeTotals {
  time_s: number;
  distance_m: number;
  gain_m: number;
  loss_m: number;
  sessions: number;
  gain_per_km: number | null;
}

export interface WeekMetrics {
  week_start: string;
  week_end: string;
  complete: boolean;
  current: VolumeTotals;
  previous: VolumeTotals;
  avg_4w: VolumeTotals | null;
  time_change_vs_previous_pct: number | null;
  time_change_vs_avg4w_pct: number | null;
  reference_rise_pct: number;
  exceeds_reference: boolean | null;
  trend: Trend;
  evidence: Evidence;
  srpe: { total_load_au: number; entries: number; evidence: Evidence } | null;
}

export interface IntensityWeek {
  week_start: string;
  week_end: string;
  zone_seconds: number[];
  hr_time_s: number;
  low_share_pct: number | null;
  delta_to_target_pct: number | null;
  activities_counted: number;
  activities_without_hr_stream: number;
  races_excluded: number;
}

export interface IntensityReport {
  target_min_pct: number;
  target_max_pct: number;
  zone_floors_bpm: number[];
  weeks: IntensityWeek[];
  average_low_share_pct: number | null;
  trend: Trend;
  evidence: Evidence;
}

export interface FitnessPoint {
  date: string;
  load: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface FitnessReport {
  start: string;
  end: string;
  points: FitnessPoint[];
  ctl_ramp_4w: number | null;
  ctl_ramp_per_week: number | null;
  history_days: number;
  trend: Trend;
  warnings: string[];
  evidence: Evidence;
  /** CTL/ATL calculés par Intervals.icu : comparaison seulement, jamais utilisés. */
  reference?: LoadReference | null;
}

export interface LoadReference {
  source: string;
  date: string;
  source_ctl: number | null;
  source_atl: number | null;
  internal_ctl: number | null;
  internal_atl: number | null;
  note: string;
}

export interface FallbackNotice {
  source: string;
  since: string;
  message: string;
}

export interface BaselineComparison {
  recent_mean: number | null;
  recent_n: number;
  baseline_mean: number | null;
  baseline_sd: number | null;
  baseline_n: number;
  baseline_days: number;
  delta: number | null;
  delta_pct: number | null;
  delta_sd: number | null;
  sufficient: boolean;
  trend: Trend;
  evidence: Evidence;
}

export interface ProprietaryMetric {
  date: string | null;
  value: number | null;
  previous_7d_mean: number | null;
  label: string;
  trend: Trend;
  evidence: Evidence;
}

export interface RecoveryMetrics {
  date: string;
  /** Garmin indisponible et Intervals.icu en repli. */
  fallback: FallbackNotice | null;
  baseline_days: number;
  hrv: BaselineComparison;
  resting_hr: BaselineComparison;
  sleep_duration_h: BaselineComparison;
  sleep_efficiency_pct: BaselineComparison;
  training_readiness: ProprietaryMetric;
  body_battery_max: ProprietaryMetric;
  body_battery_min: ProprietaryMetric;
  garmin_hrv_reference: { date: string; min: number; max: number; label: string } | null;
  acwr: { value: number; date: string; label: string; evidence: Evidence } | null;
}

export interface WellnessPoint {
  date: string;
  hrv_nuit: number | null;
  hrv_base_min: number | null;
  hrv_base_max: number | null;
  fc_repos: number | null;
  sommeil_duree_h: number | null;
  sommeil_efficacite: number | null;
  training_readiness: number | null;
  body_battery_max: number | null;
  body_battery_min: number | null;
}

export interface WellnessSeries {
  start: string;
  end: string;
  points: WellnessPoint[];
  evidence: Evidence;
}

// --- sorties -----------------------------------------------------------------------------------

export type SportGroup = "run" | "trail" | "other";

export interface Activity {
  id: number;
  source: string;
  sport: string;
  sport_group: SportGroup;
  start_utc: string;
  day: string;
  duration_min: number;
  distance_km: number | null;
  dplus_m: number | null;
  dminus_m: number | null;
  dplus_per_km: number | null;
  hr_avg: number | null;
  hr_max: number | null;
  calories: number | null;
  is_race: boolean;
  rpe: number | null;
  pace_s_per_km: number | null;
  gap_s_per_km: number | null;
}

export interface ActivityStream {
  points_total: number;
  t: (number | null)[];
  distance_km: (number | null)[];
  altitude_m: (number | null)[];
  hr: (number | null)[];
  pace_s_per_km: (number | null)[];
}

export interface ActivityZones {
  floors_bpm: number[];
  seconds: number[];
  hr_time_s: number;
  low_share_pct: number | null;
}

export interface Climb {
  start_km: number;
  end_km: number;
  length_m: number;
  gain_m: number;
  avg_grade_pct: number;
  duration_s: number | null;
  avg_hr: number | null;
  /** Vitesse ascensionnelle (m de D+ par heure de montée). */
  vam_m_per_h: number | null;
}

export interface ActivityDetail extends Activity {
  stream: ActivityStream | null;
  zones: ActivityZones | null;
  climbs: Climb[];
  /** Allure normalisée (moyenne d'ordre 4 des 30 s glissantes, à plat équivalent). */
  ngp_s_per_km: number | null;
  ascent_speed_m_per_h: number | null;
  notes: string[];
  evidence: Evidence;
}

export interface Goal {
  id: number;
  nom: string;
  date: string;
  distance_km: number | null;
  dplus_m: number | null;
  priorite: number;
  /** Profil altimétrique de la course : [km, altitude m]. */
  profil_points?: [number, number][] | null;
}

// --- phase 2 : objectif, nutrition, monotonie, fatigue, renforcement -----------------------------

export interface RecentVolume {
  window_days: number;
  distance_km: number;
  dplus_m: number;
  avg_weekly_km: number;
  avg_weekly_dplus_m: number;
  longest_km: number | null;
  longest_dplus_m: number | null;
  avg_weekly_km_vs_race_pct: number | null;
  avg_weekly_dplus_vs_race_pct: number | null;
  longest_km_vs_race_pct: number | null;
  longest_dplus_vs_race_pct: number | null;
  evidence: Evidence;
}

export interface TsbScenario {
  name: string;
  daily_load: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface RaceGoalReport {
  goal_id: number;
  nom: string;
  date: string;
  distance_km: number | null;
  dplus_m: number | null;
  days_left: number;
  profile: [number, number][] | null;
  profile_dplus_m: number | null;
  recent: RecentVolume;
  predictions: { label: string; seconds: number; note: string }[];
  projection: {
    from_date: string;
    race_date: string;
    days: number;
    scenarios: TsbScenario[];
    evidence: Evidence;
  } | null;
}

export interface GpxSummary {
  distance_km: number;
  dplus_m: number | null;
  dminus_m: number | null;
  points: number;
  goal: Goal;
}

export interface FuelingPoint {
  activity_id: number;
  day: string;
  duration_h: number;
  distance_km: number | null;
  entry_id: number | null;
  carbs_g_per_h: number | null;
  carbs_total_g: number | null;
  gi_score: number | null;
  note: string | null;
  carbs_change_g_per_h: number | null;
}

export interface FuelingSeries {
  min_hours: number;
  points: FuelingPoint[];
  missing: number;
  evidence: Evidence;
}

export interface FuelingInput {
  glucides_g_par_h: number;
  score_digestif: number;
  note?: string | null;
}

export interface MonotonyWeek {
  week_start: string;
  complete: boolean;
  load: number;
  monotony: number | null;
  strain: number | null;
  high_load: boolean | null;
  soft_alert: boolean;
  message: string | null;
}

export interface MonotonyReport {
  reference: number;
  weeks: MonotonyWeek[];
  evidence: Evidence;
}

export interface FatigueReport {
  weeks: { week_start: string; complete: boolean; loss_m: number; sessions: number; strong_sessions: number }[];
  strong_sessions: {
    activity_id: number;
    day: string;
    loss_m: number;
    loss_per_km: number | null;
    soreness_date: string;
    soreness: number | null;
  }[];
  suggestion: { after: string; easy_from: string; easy_until: string; message: string } | null;
  evidence: Evidence;
}

export interface StrengthReport {
  target: number | null;
  weeks: {
    week_start: string;
    complete: boolean;
    detected: number;
    manual: number;
    count: number;
    target: number | null;
    target_met: boolean | null;
  }[];
  evidence: Evidence;
}

// --- matériel -----------------------------------------------------------------------------------

export type GearStatus = "ok" | "surveiller" | "atteint" | "retire";

export interface GearItem {
  /** null : nom vu dans les sorties, pas encore enregistré. */
  id: number | null;
  nom: string;
  registered: boolean;
  seuil_km: number;
  km_initial: number;
  km_total: number;
  km_activities: number;
  activities: number;
  last_used: string | null;
  usage_pct: number;
  status: GearStatus;
  message: string | null;
}

export interface GearReport {
  items: GearItem[];
  unassigned: { activity_id: number; day: string; sport: string; distance_km: number | null }[];
  unassigned_total: number;
  evidence: Evidence;
}

// --- météo --------------------------------------------------------------------------------------

export interface WeatherPlace {
  nom: string;
  lat: number;
  lon: number;
}

export interface WeatherHour {
  hour: number;
  temp_c: number | null;
  feels_c: number | null;
  rain_prob_pct: number | null;
  rain_mm: number | null;
  wind_kmh: number | null;
  gust_kmh: number | null;
  label: string;
}

export interface WeatherResponse {
  day_basis: "session" | "today" | "tomorrow" | "date";
  session: { date: string; titre: string; type_label: string; duree_min: number | null } | null;
  weather: {
    place: WeatherPlace;
    day: {
      date: string;
      label: string;
      temp_min_c: number | null;
      temp_max_c: number | null;
      rain_mm: number | null;
      rain_prob_max_pct: number | null;
      wind_max_kmh: number | null;
      gust_max_kmh: number | null;
      sunrise: string | null;
      sunset: string | null;
    };
    periods: { name: string; temp_c: number | null; rain_prob_pct: number | null; rain_mm: number | null; wind_kmh: number | null }[];
    hours: WeatherHour[];
    fetched_at: number;
    stale: boolean;
    attribution: string;
    evidence: Evidence;
  };
}
