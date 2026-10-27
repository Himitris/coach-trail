import type { SourceState } from "../api/endpoints";

/** Le serveur renvoie des dates UTC sans fuseau : on les interprète comme UTC. */
export function parseUtc(value: string): Date {
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
}

const dateTime = new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" });

export function formatDateTime(value: string | null): string {
  return value ? dateTime.format(parseUtc(value)) : "—";
}

export const STATE_LABELS: Record<SourceState, string> = {
  ok: "À jour",
  degraded: "Partielle",
  auth_required: "Reconnexion requise",
  down: "Indisponible",
  jamais_synchronise: "Jamais synchronisée",
};

// --- nombres et durées (toujours en français ; une valeur absente s'affiche « — », jamais 0) ----

const MISSING = "—";
const fmt = (digits: number): Intl.NumberFormat =>
  new Intl.NumberFormat("fr-FR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const NUMBER_FORMATS = [fmt(0), fmt(1), fmt(2)] as const;

export function formatNumber(value: number | null | undefined, digits: 0 | 1 | 2 = 0): string {
  return value === null || value === undefined ? MISSING : NUMBER_FORMATS[digits].format(value);
}

/** « 1 h 05 », « 45 min ». */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return MISSING;
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

export const formatDurationS = (seconds: number | null | undefined): string =>
  formatDuration(seconds === null || seconds === undefined ? null : seconds / 60);

export const formatKm = (km: number | null | undefined): string =>
  km === null || km === undefined ? MISSING : `${formatNumber(km, 1)} km`;

export const formatMeters = (m: number | null | undefined): string =>
  m === null || m === undefined ? MISSING : `${formatNumber(m, 0)} m`;

/** Allure en minutes:secondes par km. */
export function formatPace(secondsPerKm: number | null | undefined): string {
  if (secondsPerKm === null || secondsPerKm === undefined || !Number.isFinite(secondsPerKm)) return MISSING;
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} /km`;
}

/** « +12 % », « −3 % » (vrai signe moins). */
export function formatSignedPct(pct: number | null | undefined, digits: 0 | 1 = 0): string {
  if (pct === null || pct === undefined) return MISSING;
  const text = formatNumber(Math.abs(pct), digits);
  if (Number(text.replace(",", ".").replace(/\s/g, "")) === 0) return `0 %`;
  return `${pct > 0 ? "+" : "−"}${text} %`;
}

export function formatSigned(value: number | null | undefined, digits: 0 | 1 | 2 = 0, unit = ""): string {
  if (value === null || value === undefined) return MISSING;
  const text = formatNumber(Math.abs(value), digits);
  const suffix = unit ? ` ${unit}` : "";
  if (Number(text.replace(",", ".").replace(/\s/g, "")) === 0) return `0${suffix}`;
  return `${value > 0 ? "+" : "−"}${text}${suffix}`;
}

// --- dates locales sous forme AAAA-MM-JJ ---------------------------------------------------------

export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export const todayIso = (): string => isoDate(new Date());

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDate(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
}

const dayMonth = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const weekdayDayMonth = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });

function localDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export const formatDay = (iso: string): string => dayMonth.format(localDate(iso));
export const formatWeekdayDay = (iso: string): string => weekdayDayMonth.format(localDate(iso));

/** Taille de fichier lisible (1 024 octets = 1 Ko, comme l'explorateur de fichiers). */
export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["o", "Ko", "Mo", "Go"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 ? String(Math.round(value)) : value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return `${text} ${units[unit] ?? "o"}`;
}
