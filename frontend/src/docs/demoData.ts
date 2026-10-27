import type {
  Activity,
  FatigueReport,
  FuelingSeries,
  GearReport,
  MonotonyReport,
  RaceGoalReport,
  StrengthReport,
  WeatherResponse,
} from "../api/types";
import { activity, detail, entry, evidence, fitness, intensity, match, planned, recovery, weekMetrics, weekPlan, wellness } from "../test/fixtures";

/**
 * Données d'exemple des aperçus de la Documentation : fictives, figées, jamais lues dans la base.
 * (Elles réutilisent les jeux de données des tests des widgets.)
 */

const brief = {
  id: 7,
  sport: "trail_running",
  start_utc: "2026-10-27T06:00:00",
  duration_min: 66,
  distance_km: 12.8,
  dplus_m: 130,
  hr_avg: 140,
  is_race: false,
};

const WEEK = weekPlan([
  { status: "fait", sessions: [match({ planned: planned({ id: 1, date: "2026-10-26", titre: "Repos", type: "repos", type_label: "Repos", duree_min: null, zone_cible: null, dplus_cible: null }), status: "fait" })] },
  {
    is_today: true,
    status: "fait",
    sessions: [
      match({
        planned: planned({ id: 2, titre: "Footing facile", consignes: "Allure conversationnelle, FC en zones 1 et 2." }),
        status: "fait",
        activity: brief,
        duration_delta_min: 6,
        dplus_delta_m: 30,
      }),
    ],
  },
  { status: "à venir", sessions: [match({ planned: planned({ id: 3, date: "2026-10-28", titre: "Seuil 3 × 8 min", type: "seuil", type_label: "Seuil", zone_cible: "3-4" }) })] },
  { status: "à venir", sessions: [match({ planned: planned({ id: 4, date: "2026-10-29", titre: "Footing", duree_min: 45 }) })] },
  { status: "à venir", sessions: [match({ planned: planned({ id: 5, date: "2026-10-30", titre: "Renforcement", type: "renfo", type_label: "Renforcement", duree_min: 30, zone_cible: null, dplus_cible: null }) })] },
  { status: "à venir", sessions: [match({ planned: planned({ id: 6, date: "2026-10-31", titre: "Footing", duree_min: 60 }) })] },
  { status: "à venir", sessions: [match({ planned: planned({ id: 8, date: "2026-11-01", titre: "Sortie longue", type: "longue", type_label: "Sortie longue", duree_min: 150, dplus_cible: 800 }) })] },
]);

const ACTIVITIES: Activity[] = [
  activity({ id: 1 }),
  activity({ id: 2, sport: "running", sport_group: "run", start_utc: "2026-10-23T06:30:00", day: "2026-10-23", duration_min: 55, distance_km: 9.8, dplus_m: 90, dminus_m: 85, dplus_per_km: 9.2, hr_avg: 148, hr_max: 168, rpe: 4 }),
  activity({ id: 3, start_utc: "2026-10-21T06:00:00", day: "2026-10-21", duration_min: 70, distance_km: 11.6, dplus_m: 540, dminus_m: 530, dplus_per_km: 46.6, hr_avg: 151, rpe: 7 }),
  activity({ id: 4, sport: "running", sport_group: "run", start_utc: "2026-10-19T06:30:00", day: "2026-10-19", duration_min: 45, distance_km: 7.9, dplus_m: 60, dminus_m: 55, dplus_per_km: 7.6, hr_avg: 139, rpe: 3 }),
];

const RACE_GOAL: RaceGoalReport = {
  goal_id: 1,
  nom: "Trail des 3 Rocs",
  date: "2026-11-08",
  distance_km: 31,
  dplus_m: 1600,
  days_left: 12,
  profile: [[0, 300], [5, 420], [10, 700], [18, 540], [25, 610], [31, 320]],
  profile_dplus_m: 1180,
  recent: {
    window_days: 28,
    distance_km: 140,
    dplus_m: 5200,
    avg_weekly_km: 35,
    avg_weekly_dplus_m: 1300,
    longest_km: 22,
    longest_dplus_m: 900,
    avg_weekly_km_vs_race_pct: 112.9,
    avg_weekly_dplus_vs_race_pct: 81.3,
    longest_km_vs_race_pct: 71,
    longest_dplus_vs_race_pct: 56.3,
    evidence: evidence("indicatif", "Volume récent, repère de préparation."),
  },
  predictions: [{ label: "Semi-marathon", seconds: 5700, note: "estimation de la montre, non validée" }],
  projection: {
    from_date: "2026-10-27",
    race_date: "2026-11-08",
    days: 12,
    scenarios: [
      { name: "Repos complet jusqu'à la course", daily_load: 0, ctl: 40, atl: 20, tsb: 20 },
      { name: "Charge récente maintenue", daily_load: 50, ctl: 46, atl: 52, tsb: -6 },
    ],
    evidence: evidence("indicatif", "Courbe de tendance."),
  },
};

const FUELING: FuelingSeries = {
  min_hours: 2.5,
  missing: 1,
  evidence: evidence("indicatif", "L'appli enregistre, elle ne prescrit pas."),
  points: [
    { activity_id: 10, day: "2026-10-04", duration_h: 3, distance_km: 24, entry_id: 1, carbs_g_per_h: 60, carbs_total_g: 180, gi_score: 4, note: null, carbs_change_g_per_h: null },
    { activity_id: 11, day: "2026-10-18", duration_h: 3.5, distance_km: 28, entry_id: 2, carbs_g_per_h: 75, carbs_total_g: 262.5, gi_score: 2, note: null, carbs_change_g_per_h: 15 },
    { activity_id: 12, day: "2026-10-25", duration_h: 4, distance_km: 32, entry_id: null, carbs_g_per_h: null, carbs_total_g: null, gi_score: null, note: null, carbs_change_g_per_h: null },
  ],
};

const MONOTONY: MonotonyReport = {
  reference: 2,
  evidence: evidence("indicatif", "Observationnel, petit échantillon, jamais un prédicteur de blessure."),
  weeks: [
    { week_start: "2026-10-05", complete: true, load: 420, monotony: 1.1, strain: 460, high_load: false, soft_alert: false, message: null },
    { week_start: "2026-10-12", complete: true, load: 300, monotony: 0.87, strain: 260, high_load: false, soft_alert: false, message: null },
    { week_start: "2026-10-19", complete: false, load: 700, monotony: 2.4, strain: 1680, high_load: true, soft_alert: true, message: "Charge élevée et peu de variation : information seulement." },
  ],
};

const FATIGUE: FatigueReport = {
  weeks: [
    { week_start: "2026-10-05", complete: true, loss_m: 1100, sessions: 4, strong_sessions: 0 },
    { week_start: "2026-10-12", complete: true, loss_m: 1500, sessions: 4, strong_sessions: 1 },
    { week_start: "2026-10-19", complete: false, loss_m: 400, sessions: 2, strong_sessions: 0 },
  ],
  strong_sessions: [{ activity_id: 5, day: "2026-10-14", loss_m: 1100, loss_per_km: 55, soreness_date: "2026-10-16", soreness: 7 }],
  suggestion: { after: "2026-10-26", easy_from: "2026-10-27", easy_until: "2026-10-29", message: "Grosse descente le 2026-10-26 : le repère courant est de 2 à 3 jours faciles. Information, pas une prescription." },
  evidence: evidence("indicatif", "La descente produit l'essentiel du dommage musculaire."),
};

const STRENGTH: StrengthReport = {
  target: 2,
  evidence: evidence("indicatif", "Compteur simple de séances."),
  weeks: [
    { week_start: "2026-10-12", complete: true, detected: 1, manual: 0, count: 1, target: 2, target_met: false },
    { week_start: "2026-10-19", complete: false, detected: 1, manual: 2, count: 2, target: 2, target_met: true },
  ],
};

const GEAR: GearReport = {
  items: [
    { id: 1, nom: "Speedcross 6", registered: true, seuil_km: 800, km_initial: 0, km_total: 412.4, km_activities: 412.4, activities: 38, last_used: "2026-10-24", usage_pct: 51.55, status: "ok", message: null },
    { id: 2, nom: "Pegasus 40", registered: true, seuil_km: 800, km_initial: 0, km_total: 760, km_activities: 760, activities: 70, last_used: "2026-10-20", usage_pct: 95, status: "surveiller", message: "Environ 95 % du seuil de 800 km : à surveiller. Repère personnel, l'usure réelle varie." },
  ],
  unassigned: [],
  unassigned_total: 0,
  evidence: evidence("indicatif", "Le seuil d'usure est un repère personnel."),
};

const PLACE = { nom: "Bruniquel, Occitanie", lat: 44.0364, lon: 1.6667 };

const WEATHER: WeatherResponse = {
  day_basis: "session",
  session: { date: "2026-10-28", titre: "Seuil 3 × 8 min", type_label: "Seuil", duree_min: 70 },
  weather: {
    place: PLACE,
    day: { date: "2026-10-28", label: "Pluie faible", temp_min_c: 7, temp_max_c: 14, rain_mm: 2.5, rain_prob_max_pct: 50, wind_max_kmh: 24, gust_max_kmh: 40, sunrise: "07:52", sunset: "18:41" },
    periods: [
      { name: "Matin (6–12 h)", temp_c: 9.5, rain_prob_pct: 30, rain_mm: 0.6, wind_kmh: 18 },
      { name: "Après-midi (12–18 h)", temp_c: 13, rain_prob_pct: 50, rain_mm: 1.6, wind_kmh: 24 },
      { name: "Soir (18–22 h)", temp_c: 10, rain_prob_pct: 30, rain_mm: 0.3, wind_kmh: 14 },
    ],
    hours: [6, 7, 8, 9, 10, 11].map((hour) => ({ hour, temp_c: 8 + hour / 2, feels_c: 6, rain_prob_pct: 20, rain_mm: 0, wind_kmh: 12, gust_kmh: 25, label: "Couvert" })),
    fetched_at: 1_800_000_000,
    stale: false,
    attribution: "Prévisions : Open-Meteo.com (CC BY 4.0).",
    evidence: evidence("indicatif", "Prévision d'un modèle météo, à revoir la veille."),
  },
};

const GOALS = [
  { id: 1, nom: "Trail des 3 Rocs", date: "2026-11-08", distance_km: 31, dplus_m: 1600, priorite: 1 },
  { id: 2, nom: "Trail de Bruniquel", date: "2027-02-14", distance_km: 39, dplus_m: null, priorite: 2 },
];

/** Réponse d'exemple pour un chemin d'API, ou `undefined` si le chemin n'est pas simulé. */
export function demoResponse(method: string, fullPath: string): unknown {
  if (method !== "GET") return undefined;
  const [path = "", search = ""] = fullPath.split("?");
  const query = new URLSearchParams(search);
  switch (path) {
    case "/api/plan/week":
      return WEEK;
    case "/api/metrics/week":
      return weekMetrics();
    case "/api/metrics/intensity":
      return intensity();
    case "/api/metrics/fitness":
      return fitness();
    case "/api/metrics/recovery":
      return recovery();
    case "/api/metrics/wellness":
      return wellness();
    case "/api/metrics/monotony":
      return MONOTONY;
    case "/api/metrics/fatigue":
      return FATIGUE;
    case "/api/metrics/strength":
      return STRENGTH;
    case "/api/metrics/race-goal":
      return RACE_GOAL;
    case "/api/fueling/series":
      return FUELING;
    case "/api/goals":
      return GOALS;
    case "/api/entries":
      return [entry()];
    case "/api/gear":
      return GEAR;
    case "/api/weather":
      return WEATHER;
    case "/api/weather/location":
      return PLACE;
    case "/api/activities":
      return query.get("races_only") === "true" ? [] : ACTIVITIES;
    default: {
      const m = /^\/api\/activities\/(\d+)$/.exec(path);
      if (m) return detail({ id: Number(m[1]) });
      return undefined;
    }
  }
}

/** Réglages d'exemple propres à un widget (ex. le texte de la note). */
export function demoSettings(widgetId: string): Record<string, unknown> {
  if (widgetId === "note") {
    return { text: "# Consignes de la semaine\n- 80 % du temps en zones 1-2\n- Dimanche : sortie longue, 60 g de glucides par heure\n- Pas de fractionné si les courbatures dépassent 6/10" };
  }
  return {};
}
