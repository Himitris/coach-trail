import { addDays, mondayOf } from "../imports/week";

export type CalendarView = "semaine" | "mois";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Date valide AAAA-MM-JJ (sinon `fallback`). */
export function parseDate(value: string | null, fallback: string): string {
  if (!value || !ISO.test(value)) return fallback;
  const [y = 0, m = 1, d = 1] = value.split("-").map(Number);
  const real = new Date(Date.UTC(y, m - 1, d));
  return real.getUTCFullYear() === y && real.getUTCMonth() === m - 1 && real.getUTCDate() === d ? value : fallback;
}

export const parseView = (value: string | null): CalendarView => (value === "mois" ? "mois" : "semaine");

const firstOfMonth = (day: string): string => `${day.slice(0, 7)}-01`;

function lastOfMonth(day: string): string {
  const [y = 1970, m = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/** Période affichée : la semaine (lundi–dimanche), ou le mois complété jusqu'aux lundis/dimanches. */
export function rangeFor(view: CalendarView, day: string): { from: string; to: string } {
  if (view === "semaine") {
    const from = mondayOf(day);
    return { from, to: addDays(from, 6) };
  }
  return { from: mondayOf(firstOfMonth(day)), to: addDays(mondayOf(lastOfMonth(day)), 6) };
}

/** Date de référence après un pas en avant (+1) ou en arrière (−1) ; un mois reste sur le 1er du mois. */
export function shiftDate(view: CalendarView, day: string, direction: 1 | -1): string {
  if (view === "semaine") return addDays(day, 7 * direction);
  const [y = 1970, m = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + direction, 1)).toISOString().slice(0, 10);
}

/** Nombre de semaines (lignes) de la période. */
export const weekCount = (from: string, to: string): number => Math.round(((Date.parse(to) - Date.parse(from)) / 86_400_000 + 1) / 7);

const monthName = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const dayName = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" });

export function periodTitle(view: CalendarView, day: string): string {
  const [y = 1970, m = 1] = day.split("-").map(Number);
  if (view === "mois") return monthName.format(new Date(y, m - 1, 1));
  const from = mondayOf(day);
  const [fy = 1970, fm = 1, fd = 1] = from.split("-").map(Number);
  const [ty = 1970, tm = 1, td = 1] = addDays(from, 6).split("-").map(Number);
  return `Semaine du ${dayName.format(new Date(fy, fm - 1, fd))} au ${dayName.format(new Date(ty, tm - 1, td))}`;
}

/** Une couleur par plan (palette à contraste suffisant sur fond sombre et clair) ; gris sans plan. */
export const PLAN_COLORS = ["#7aa7ff", "#f2b34c", "#c792ea", "#5cf2c4", "#ff8fa3", "#4dd0e1"] as const;
export const NO_PLAN_COLOR = "#8a94a3";

export function planColor(planId: number | null): string {
  return planId === null ? NO_PLAN_COLOR : (PLAN_COLORS[planId % PLAN_COLORS.length] ?? NO_PLAN_COLOR);
}
