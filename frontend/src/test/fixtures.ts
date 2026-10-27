import type {
  Activity,
  ActivityDetail,
  DayPlan,
  Evidence,
  Entry,
  FitnessReport,
  IntensityReport,
  PlannedSession,
  RecoveryMetrics,
  SessionMatch,
  Trend,
  WeekMetrics,
  WeekPlan,
  WellnessSeries,
  BaselineComparison,
  ProprietaryMetric,
  VolumeTotals,
} from "../api/types";

export const evidence = (level: Evidence["level"] = "indicatif", summary = "Phrase de preuve."): Evidence => ({
  level,
  summary,
});
export const trend = (direction: Trend["direction"] = "stable"): Trend => ({
  direction,
  delta: null,
  delta_pct: null,
  window: "test",
});

export const planned = (over: Partial<PlannedSession> = {}): PlannedSession => ({
  id: 1,
  plan_id: null,
  plan_nom: null,
  date: "2026-10-27",
  titre: "Footing facile",
  type: "footing",
  type_label: "Footing",
  objectif: null,
  duree_min: 60,
  zone_cible: "1-2",
  dplus_cible: 100,
  consignes: null,
  status: "à venir",
  ...over,
});

export const match = (over: Partial<SessionMatch> = {}): SessionMatch => ({
  planned: planned(),
  status: "à venir",
  activity: null,
  duration_delta_min: null,
  duration_ratio: null,
  dplus_delta_m: null,
  ...over,
});

export const day = (over: Partial<DayPlan> = {}): DayPlan => ({
  date: "2026-10-27",
  weekday: "mardi",
  is_today: false,
  status: null,
  sessions: [],
  unplanned_activities: [],
  entry: null,
  ...over,
});

const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const DATES = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"];

export function weekPlan(days: Partial<DayPlan>[] = [], over: Partial<WeekPlan> = {}): WeekPlan {
  return {
    week_start: "2026-10-26",
    week_end: "2026-11-01",
    planned_min: 465,
    done_min: 66,
    days: WEEKDAYS.map((weekday, i) =>
      day({ date: DATES[i] ?? "", weekday, ...(days[i] ?? {}) }),
    ),
    ...over,
  };
}

export const totals = (over: Partial<VolumeTotals> = {}): VolumeTotals => ({
  time_s: 10800,
  distance_m: 30000,
  gain_m: 1200,
  loss_m: 1170,
  sessions: 2,
  gain_per_km: 40,
  ...over,
});

export const weekMetrics = (over: Partial<WeekMetrics> = {}): WeekMetrics => ({
  week_start: "2026-10-19",
  week_end: "2026-10-25",
  complete: true,
  current: totals(),
  previous: totals({ time_s: 9000, distance_m: 25000, gain_m: 900, loss_m: 880, sessions: 3 }),
  avg_4w: totals({ time_s: 7650, distance_m: 22000, gain_m: 800, loss_m: 790, sessions: 2.5, gain_per_km: 36 }),
  time_change_vs_previous_pct: 20,
  time_change_vs_avg4w_pct: 41.2,
  reference_rise_pct: 10,
  exceeds_reference: true,
  trend: trend("hausse"),
  evidence: evidence("etabli", "Volumes mesurés par la montre."),
  srpe: null,
  ...over,
});

export const activity = (over: Partial<Activity> = {}): Activity => ({
  id: 1,
  source: "garmin",
  sport: "trail_running",
  sport_group: "trail",
  start_utc: "2026-10-25T06:00:00",
  day: "2026-10-25",
  duration_min: 125,
  distance_km: 18.4,
  dplus_m: 820,
  dminus_m: 810,
  dplus_per_km: 44.6,
  hr_avg: 142,
  hr_max: 171,
  calories: 1300,
  is_race: false,
  rpe: 6,
  pace_s_per_km: 407,
  gap_s_per_km: null,
  ...over,
});

export const detail = (over: Partial<ActivityDetail> = {}): ActivityDetail => ({
  ...activity(),
  stream: {
    points_total: 7500,
    t: [0, 60, 120, 180],
    distance_km: [0, 0.5, 1, 1.5],
    altitude_m: [300, 330, 380, 420],
    hr: [120, 140, 150, 155],
    pace_s_per_km: [360, 420, 480, 500],
  },
  zones: {
    floors_bpm: [98, 117, 137, 156, 176],
    seconds: [0, 600, 3000, 3600, 300, 0],
    hr_time_s: 7500,
    low_share_pct: 48,
  },
  climbs: [
    { start_km: 0.4, end_km: 1.5, length_m: 1100, gain_m: 120, avg_grade_pct: 10.9, duration_s: 540, avg_hr: 152, vam_m_per_h: 800 },
  ],
  ngp_s_per_km: 455,
  ascent_speed_m_per_h: 800,
  notes: [],
  evidence: evidence("indicatif", "Les côtes sont détectées sur le profil lissé."),
  ...over,
});

export const intensity = (over: Partial<IntensityReport> = {}): IntensityReport => ({
  target_min_pct: 75,
  target_max_pct: 80,
  zone_floors_bpm: [98, 117, 137, 156, 176],
  weeks: [
    { week_start: "2026-10-12", week_end: "2026-10-18", zone_seconds: [0, 1000, 6000, 2000, 1000, 0], hr_time_s: 10000, low_share_pct: 70, delta_to_target_pct: -5, activities_counted: 4, activities_without_hr_stream: 0, races_excluded: 0 },
    { week_start: "2026-10-19", week_end: "2026-10-25", zone_seconds: [0, 2000, 6000, 1500, 500, 0], hr_time_s: 10000, low_share_pct: 80, delta_to_target_pct: 0, activities_counted: 4, activities_without_hr_stream: 1, races_excluded: 1 },
  ],
  average_low_share_pct: 75,
  trend: trend("hausse"),
  evidence: evidence("indicatif", "Zones 1–2 Garmin = bas d'intensité."),
  ...over,
});

export const fitness = (over: Partial<FitnessReport> = {}): FitnessReport => ({
  start: "2026-10-01",
  end: "2026-10-27",
  points: [
    { date: "2026-10-25", load: 80, ctl: 50.5, atl: 58.2, tsb: -7.7 },
    { date: "2026-10-26", load: 0, ctl: 49.3, atl: 50.4, tsb: -1.1 },
    { date: "2026-10-27", load: 60, ctl: 49.9, atl: 51.9, tsb: -2 },
  ],
  ctl_ramp_4w: 3.2,
  ctl_ramp_per_week: 0.8,
  history_days: 200,
  trend: trend("hausse"),
  warnings: [],
  evidence: evidence("indicatif", "Courbes de tendance, pas un verdict."),
  ...over,
});

const baseline = (over: Partial<BaselineComparison> = {}): BaselineComparison => ({
  recent_mean: 66,
  recent_n: 7,
  baseline_mean: 60,
  baseline_sd: 4.1,
  baseline_n: 60,
  baseline_days: 60,
  delta: 6,
  delta_pct: 10,
  delta_sd: 1.5,
  sufficient: true,
  trend: trend("hausse"),
  evidence: evidence("indicatif", "HRV : tendance face à la base, pas de seuil quotidien."),
  ...over,
});

export const proprietary = (value: number | null, over: Partial<ProprietaryMetric> = {}): ProprietaryMetric => ({
  date: value === null ? null : "2026-10-27",
  value,
  previous_7d_mean: null,
  label: "avis Garmin, non validé",
  trend: trend("indetermine"),
  evidence: evidence("avis_montre", "Indicateur propriétaire Garmin."),
  ...over,
});

export const recovery = (over: Partial<RecoveryMetrics> = {}): RecoveryMetrics => ({
  date: "2026-10-27",
  fallback: null,
  baseline_days: 60,
  hrv: baseline(),
  resting_hr: baseline({ recent_mean: 47, baseline_mean: 48, delta_pct: -2, delta_sd: -0.9, trend: trend("baisse") }),
  sleep_duration_h: baseline({ recent_mean: 7.5, baseline_mean: 7.4, delta_pct: 1.6, delta_sd: 0.3, trend: trend("stable") }),
  sleep_efficiency_pct: baseline({ recent_mean: 89, baseline_mean: 88, delta_pct: 0.5, delta_sd: 0.2, trend: trend("stable") }),
  training_readiness: proprietary(54),
  body_battery_max: proprietary(83),
  body_battery_min: proprietary(21),
  garmin_hrv_reference: { date: "2026-10-27", min: 54, max: 70, label: "plage de référence Garmin" },
  acwr: null,
  ...over,
});

export const wellness = (over: Partial<WellnessSeries> = {}): WellnessSeries => ({
  start: "2026-09-30",
  end: "2026-10-27",
  points: [
    "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27",
  ].map((date, i) => ({
    date,
    hrv_nuit: 60 + i,
    hrv_base_min: 54,
    hrv_base_max: 70,
    fc_repos: 48,
    sommeil_duree_h: 7.5,
    sommeil_efficacite: 89,
    training_readiness: 54,
    body_battery_max: 83,
    body_battery_min: 21,
  })),
  evidence: evidence("avis_montre", "Valeurs mesurées par la montre."),
  ...over,
});

export const entry = (over: Partial<Entry> = {}): Entry => ({
  date: "2026-10-27",
  courbatures: null,
  malade: null,
  note: null,
  sessions: [],
  updated_at: null,
  ...over,
});
