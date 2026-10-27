import type { ComponentType } from "react";

export type SettingField =
  | { key: string; label: string; type: "select"; options: readonly { value: string; label: string }[] }
  | { key: string; label: string; type: "text"; placeholder?: string }
  | { key: string; label: string; type: "number"; min?: number; max?: number; step?: number }
  | { key: string; label: string; type: "boolean" };

/** Contenu exporté par un widget (le bouton d'export du cadre l'assemblera au prompt 09). */
export interface ExportBlock {
  title: string;
  markdown: string;
}

export type WidgetSettings = Record<string, unknown>;

export interface WidgetProps<S extends WidgetSettings = WidgetSettings> {
  instanceId: string;
  settings: S;
  /** Fusionne un changement dans les réglages (persisté avec la disposition). */
  updateSettings: (patch: Partial<S>) => void;
}

/** Taille en unités de la grille d'ordinateur (12 colonnes) ; la hauteur d'une unité vaut ~80 px. */
export interface WidgetSize {
  w: number;
  h: number;
}

export interface WidgetDefinition<S extends WidgetSettings = WidgetSettings> {
  id: string;
  title: string;
  description: string;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  defaultSettings: S;
  settingsSchema: readonly SettingField[];
  Component: ComponentType<WidgetProps<S>>;
  /** Données du widget pour l'export vers Claude ; `null` = rien à exporter. */
  exportData: (settings: S) => ExportBlock | null | Promise<ExportBlock | null>;
}
