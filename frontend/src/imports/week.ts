export const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] as const;

const DAY_MS = 86_400_000;

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export function addDays(day: string, n: number): string {
  return new Date(toUtc(day) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Lundi de la semaine contenant `day`. */
export function mondayOf(day: string): string {
  const weekday = new Date(toUtc(day)).getUTCDay(); // 0 = dimanche
  return addDays(day, -((weekday + 6) % 7));
}

export function todayLocal(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function normalize(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

/** Index 0–6 (lundi–dimanche) d'un nom de jour, accents et casse ignorés ; -1 si inconnu. */
export function weekdayIndex(name: unknown): number {
  return typeof name === "string" ? WEEKDAYS.indexOf(normalize(name) as (typeof WEEKDAYS)[number]) : -1;
}

/**
 * Transforme une semaine type en séances datées pour la semaine commençant à `weekStart`.
 * Renvoie les erreurs (jour inconnu) au lieu de deviner.
 */
export function expandWeekTemplate(
  template: unknown,
  weekStart: string,
): { sessions: Record<string, unknown>[]; errors: string[] } {
  const errors: string[] = [];
  const sessions: Record<string, unknown>[] = [];
  if (!Array.isArray(template)) return { sessions, errors: ["« semaine_type » doit être une liste."] };
  template.forEach((raw: unknown, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(`Ligne ${i + 1} de la semaine type : doit être un objet JSON.`);
      return;
    }
    const { jour, ...rest } = raw as Record<string, unknown>;
    const index = weekdayIndex(jour);
    if (index < 0) {
      errors.push(`Ligne ${i + 1} de la semaine type : « jour » doit être ${WEEKDAYS.join(", ")} (reçu : ${JSON.stringify(jour)}).`);
      return;
    }
    sessions.push({ date: addDays(weekStart, index), ...rest });
  });
  return { sessions, errors };
}
