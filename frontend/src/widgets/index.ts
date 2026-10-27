// Importer ce module enregistre tous les widgets disponibles.
import "./NoteWidget";
import "./WeekPlanWidget";
import "./WeekLoadWidget";
import "./RecentActivitiesWidget";
import "./ActivityDetailWidget";
import "./IntensityWidget";
import "./FitnessWidget";
import "./RecoveryWidget";
import "./EveningEntryWidget";

export { getWidget, listWidgets, specFor } from "./registry";

/** Widgets de la page d'accueil créée par défaut, dans l'ordre. */
export const HOME_WIDGET_TYPES = [
  "week-plan",
  "week-load",
  "recent-activities",
  "recovery",
  "evening-entry",
] as const;
