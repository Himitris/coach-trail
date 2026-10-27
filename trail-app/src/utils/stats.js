// Helpers pour les graphiques de l'écran Stats

// Régression linéaire simple — renvoie un tableau de valeurs lissées (tendance)
export function linearTrend(values) {
  const n = values.length;
  if (n < 2) return values.slice();
  const xs = values.map((_, i) => i);
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = values.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * values[i], 0);
  const sumXX = xs.reduce((acc, x) => acc + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return values.slice();
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  return xs.map(x => intercept + slope * x);
}

export function trendDirection(values) {
  if (values.length < 2) return 'flat';
  const trend = linearTrend(values);
  const delta = trend[trend.length - 1] - trend[0];
  const ref = Math.max(Math.abs(trend[0]), 1);
  if (delta / ref > 0.03) return 'up';
  if (delta / ref < -0.03) return 'down';
  return 'flat';
}

// Cible de durée des sorties longues par mois (plan de progression)
// Renvoie [min, max] en secondes pour une date donnée, ou null si hors plan
const LONG_RUN_TARGETS = [
  { year: 2026, month: 4, range: [2.5, 2.75] },
  { year: 2026, month: 5, range: [2.75, 3.0] },
  { year: 2026, month: 6, range: [3.0, 3.0] },
  { year: 2026, month: 7, range: [3.0, 3.25] },
  { year: 2026, month: 8, range: [3.0, 3.25] },
  { year: 2026, month: 9, range: [3.0, 3.25] },
  { year: 2026, month: 10, range: [2.5, 2.75] },
  { year: 2026, month: 11, range: [1.5, 2.0] },
];

export function longRunTargetForDate(dateStr) {
  const d = new Date(dateStr);
  const entry = LONG_RUN_TARGETS.find(t => t.year === d.getFullYear() && t.month === d.getMonth() + 1);
  if (!entry) return null;
  return entry.range.map(h => h * 3600);
}

export function longRunTargetMid(dateStr) {
  const range = longRunTargetForDate(dateStr);
  if (!range) return null;
  return (range[0] + range[1]) / 2;
}

export const OBJECTIVE_DATE = new Date('2026-11-08T00:00:00');
export const PLAN_START_DATE = new Date('2025-04-01T00:00:00');

export function objectiveProgress(now = new Date()) {
  const total = OBJECTIVE_DATE.getTime() - PLAN_START_DATE.getTime();
  const elapsed = now.getTime() - PLAN_START_DATE.getTime();
  const ratio = Math.min(Math.max(elapsed / total, 0), 1);
  const daysLeft = Math.max(Math.ceil((OBJECTIVE_DATE.getTime() - now.getTime()) / 86400000), 0);
  return { ratio, daysLeft };
}
