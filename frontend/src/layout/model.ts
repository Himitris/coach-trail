/** Modèle de la disposition (identique au document stocké par `GET/PUT /api/layout`). */

export type Breakpoint = "lg" | "md" | "sm";

export const BREAKPOINTS: readonly Breakpoint[] = ["lg", "md", "sm"];

/** Colonnes de la grille par point de rupture : ordinateur / tablette / téléphone. */
export const COLS: Record<Breakpoint, number> = { lg: 12, md: 8, sm: 4 };

/** Largeur minimale (px) de la zone de grille pour chaque point de rupture. */
export const BREAKPOINT_MIN_WIDTH: Record<Breakpoint, number> = { lg: 1000, md: 640, sm: 0 };

export const BREAKPOINT_LABELS: Record<Breakpoint, string> = {
  lg: "ordinateur",
  md: "tablette",
  sm: "téléphone",
};

export interface GridItem {
  /** Identifiant du widget placé. */
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WidgetInstance {
  id: string;
  type: string;
  settings: Record<string, unknown>;
}

export type PageLayouts = Partial<Record<Breakpoint, GridItem[]>>;

export interface Page {
  id: string;
  title: string;
  widgets: WidgetInstance[];
  layouts: PageLayouts;
}

export interface DashboardLayout {
  pages: Page[];
  home_page_id: string | null;
}

/** Taille d'un widget, exprimée en unités de la grille d'ordinateur (12 colonnes). */
export interface SizeSpec {
  w: number;
  h: number;
  minW: number;
  minH: number;
}

export function breakpointForWidth(width: number): Breakpoint {
  if (width >= BREAKPOINT_MIN_WIDTH.lg) return "lg";
  if (width >= BREAKPOINT_MIN_WIDTH.md) return "md";
  return "sm";
}
