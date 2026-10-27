import type { SizeSpec } from "../layout/model";
import { FALLBACK_SPEC } from "../layout/defaults";
import type { WidgetDefinition, WidgetSettings } from "./types";

const definitions = new Map<string, WidgetDefinition>();

/** Déclare un widget typé et l'enregistre (l'`id` sert de `type` dans la disposition). */
export function registerWidget<S extends WidgetSettings>(definition: WidgetDefinition<S>): void {
  if (definitions.has(definition.id)) throw new Error(`Widget déjà enregistré : ${definition.id}`);
  // Les définitions sont stockées sans leur type de réglages : chaque instance reçoit les siens.
  definitions.set(definition.id, definition as unknown as WidgetDefinition);
}

export function getWidget(type: string): WidgetDefinition | undefined {
  return definitions.get(type);
}

export function listWidgets(): WidgetDefinition[] {
  return [...definitions.values()].sort((a, b) => a.title.localeCompare(b.title, "fr"));
}

/** Taille (grille d'ordinateur) d'un type de widget ; valeur neutre si le type est inconnu. */
export function specFor(type: string): SizeSpec {
  const def = definitions.get(type);
  if (!def) return FALLBACK_SPEC;
  return { w: def.defaultSize.w, h: def.defaultSize.h, minW: def.minSize.w, minH: def.minSize.h };
}

/** Réservé aux tests. */
export function clearRegistry(): void {
  definitions.clear();
}
