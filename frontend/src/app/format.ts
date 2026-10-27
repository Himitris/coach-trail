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
