import type { PlanStatus, SessionType } from "../api/types";

export const SESSION_TYPE_OPTIONS: { value: SessionType; label: string }[] = [
  { value: "footing", label: "Footing" },
  { value: "cotes", label: "Côtes" },
  { value: "seuil", label: "Seuil" },
  { value: "longue", label: "Sortie longue" },
  { value: "fractionne", label: "Fractionné" },
  { value: "course", label: "Course" },
  { value: "renfo", label: "Renforcement" },
  { value: "repos", label: "Repos" },
  { value: "autre", label: "Autre" },
];

const SPORT_LABELS: Record<string, string> = {
  trail_running: "Trail",
  running: "Course à pied",
  treadmill_running: "Tapis",
  track_running: "Piste",
  virtual_run: "Course virtuelle",
  ultra_run: "Ultra",
  hiking: "Randonnée",
  walking: "Marche",
  cycling: "Vélo",
  mountain_biking: "VTT",
  strength_training: "Renforcement",
  fitness_equipment: "Fitness",
  hiit: "HIIT",
  indoor_cardio: "Cardio",
  yoga: "Yoga",
  pilates: "Pilates",
  swimming: "Natation",
};

export function sportLabel(sport: string): string {
  return SPORT_LABELS[sport] ?? sport.replace(/_/g, " ");
}

/** Texte du statut du programme (le statut est toujours écrit, jamais seulement coloré). */
export const STATUS_CLASS: Record<PlanStatus, string> = {
  fait: "done",
  manqué: "missed",
  partiel: "partial",
  "à venir": "upcoming",
  imprévu: "unplanned",
};
