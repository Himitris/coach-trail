import {
  BREAKPOINTS,
  COLS,
  type Breakpoint,
  type DashboardLayout,
  type GridItem,
  type Page,
  type SizeSpec,
} from "./model";

export const FALLBACK_SPEC: SizeSpec = { w: 4, h: 4, minW: 2, minH: 2 };
export const HOME_TITLE = "Accueil";

const clamp = (n: number, lo: number, hi: number): number => Math.min(Math.max(n, lo), hi);

/** Taille d'un widget pour un point de rupture (la largeur est mise à l'échelle des colonnes). */
export function sizeFor(bp: Breakpoint, spec: SizeSpec): { w: number; h: number; minW: number; minH: number } {
  const cols = COLS[bp];
  if (bp === "sm") return { w: cols, h: spec.h, minW: Math.min(2, cols), minH: spec.minH };
  const scale = (n: number): number => clamp(Math.ceil((n * cols) / COLS.lg), 1, cols);
  return { w: scale(spec.w), h: spec.h, minW: scale(spec.minW), minH: spec.minH };
}

/** Position d'un nouveau widget : en bas à gauche (la grille le remonte ensuite si de la place). */
export function appendItem(bp: Breakpoint, items: readonly GridItem[], id: string, spec: SizeSpec): GridItem[] {
  const bottom = items.reduce((max, it) => Math.max(max, it.y + it.h), 0);
  const { w, h } = sizeFor(bp, spec);
  return [...items, { i: id, x: 0, y: bottom, w, h }];
}

/** Disposition par défaut : les widgets, dans l'ordre, rangés en lignes de gauche à droite. */
export function packDefault(
  bp: Breakpoint,
  widgets: readonly { id: string; spec: SizeSpec }[],
): GridItem[] {
  const cols = COLS[bp];
  const items: GridItem[] = [];
  let x = 0;
  let rowTop = 0;
  let rowHeight = 0;
  for (const { id, spec } of widgets) {
    const { w, h } = sizeFor(bp, spec);
    if (x + w > cols) {
      x = 0;
      rowTop += rowHeight;
      rowHeight = 0;
    }
    items.push({ i: id, x, y: rowTop, w, h });
    x += w;
    rowHeight = Math.max(rowHeight, h);
  }
  return items;
}

/** Ramène un élément dans la grille (largeur ≤ colonnes, pas de débordement à droite). */
function fit(bp: Breakpoint, item: GridItem): GridItem {
  const cols = COLS[bp];
  const w = clamp(Math.round(item.w), 1, cols);
  return {
    i: item.i,
    x: clamp(Math.round(item.x), 0, cols - w),
    y: Math.max(0, Math.round(item.y)),
    w,
    h: Math.max(1, Math.round(item.h)),
  };
}

/**
 * Rend une page cohérente : chaque widget a une position à chaque point de rupture (les manquants
 * sont ajoutés en bas), aucune position orpheline ou en double, tout reste dans la grille.
 */
export function sanitizePage(page: Page, specFor: (type: string) => SizeSpec): Page {
  const layouts: Page["layouts"] = {};
  for (const bp of BREAKPOINTS) {
    const known = new Set(page.widgets.map((w) => w.id));
    const seen = new Set<string>();
    let items: GridItem[] = [];
    for (const item of page.layouts[bp] ?? []) {
      if (known.has(item.i) && !seen.has(item.i)) {
        seen.add(item.i);
        items.push(fit(bp, item));
      }
    }
    for (const widget of page.widgets) {
      if (!seen.has(widget.id)) items = appendItem(bp, items, widget.id, specFor(widget.type));
    }
    layouts[bp] = items;
  }
  return { ...page, layouts };
}

export function sanitizeLayout(
  layout: DashboardLayout,
  specFor: (type: string) => SizeSpec,
): DashboardLayout {
  const pages = layout.pages.map((p) => sanitizePage(p, specFor));
  const home = pages.some((p) => p.id === layout.home_page_id) ? layout.home_page_id : null;
  return { pages, home_page_id: home ?? pages[0]?.id ?? null };
}

export function emptyPage(id: string, title: string): Page {
  return { id, title, widgets: [], layouts: { lg: [], md: [], sm: [] } };
}

export function defaultLayout(homeId: string): DashboardLayout {
  return { pages: [emptyPage(homeId, HOME_TITLE)], home_page_id: homeId };
}
