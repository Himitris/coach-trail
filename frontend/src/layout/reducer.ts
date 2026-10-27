import { emptyPage, packDefault, appendItem, sanitizePage } from "./defaults";
import { BREAKPOINTS, type Breakpoint, type DashboardLayout, type GridItem, type Page, type SizeSpec } from "./model";

export const MAX_PAGE_TITLE = 60;

export type LayoutAction =
  | { type: "replace"; layout: DashboardLayout }
  | { type: "addPage"; id: string; title?: string }
  | { type: "renamePage"; id: string; title: string }
  | { type: "duplicatePage"; id: string; newId: string }
  | { type: "movePage"; id: string; toIndex: number }
  | { type: "deletePage"; id: string }
  | { type: "setHome"; id: string }
  | { type: "addWidget"; pageId: string; widgetId: string; widgetType: string; settings?: Record<string, unknown> }
  | { type: "removeWidget"; pageId: string; widgetId: string }
  | { type: "updateSettings"; pageId: string; widgetId: string; patch: Record<string, unknown> }
  | { type: "setBreakpointLayout"; pageId: string; bp: Breakpoint; items: readonly GridItem[] }
  | { type: "resetBreakpoint"; pageId: string; bp: Breakpoint };

export type SpecFor = (type: string) => SizeSpec;

function mapPage(state: DashboardLayout, id: string, fn: (page: Page) => Page): DashboardLayout {
  const index = state.pages.findIndex((p) => p.id === id);
  const current = state.pages[index];
  if (!current) return state;
  const next = fn(current);
  if (next === current) return state; // rien n'a changé : même objet, pas de sauvegarde
  return { ...state, pages: state.pages.map((p, i) => (i === index ? next : p)) };
}

export function cleanTitle(title: string): string {
  return title.trim().slice(0, MAX_PAGE_TITLE);
}

/** Titre « X (copie) » sans dépasser la longueur maximale. */
function copyTitle(title: string): string {
  const suffix = " (copie)";
  return title.slice(0, MAX_PAGE_TITLE - suffix.length) + suffix;
}

export function createReducer(specFor: SpecFor) {
  return function reducer(state: DashboardLayout, action: LayoutAction): DashboardLayout {
    switch (action.type) {
      case "replace":
        return action.layout;

      case "addPage": {
        if (state.pages.some((p) => p.id === action.id)) return state;
        const title = cleanTitle(action.title ?? "") || `Page ${state.pages.length + 1}`;
        return {
          pages: [...state.pages, emptyPage(action.id, title)],
          home_page_id: state.home_page_id ?? action.id,
        };
      }

      case "renamePage": {
        const title = cleanTitle(action.title);
        if (!title) return state; // un titre vide est ignoré
        return mapPage(state, action.id, (p) => (p.title === title ? p : { ...p, title }));
      }

      case "duplicatePage": {
        const index = state.pages.findIndex((p) => p.id === action.id);
        const source = state.pages[index];
        if (!source || state.pages.some((p) => p.id === action.newId)) return state;
        // Les identifiants de widgets ne doivent être uniques qu'au sein d'une page.
        const copy: Page = structuredClone({ ...source, id: action.newId, title: copyTitle(source.title) });
        const pages = [...state.pages];
        pages.splice(index + 1, 0, copy);
        return { ...state, pages };
      }

      case "movePage": {
        const from = state.pages.findIndex((p) => p.id === action.id);
        if (from < 0) return state;
        const to = Math.min(Math.max(action.toIndex, 0), state.pages.length - 1);
        if (to === from) return state;
        const pages = [...state.pages];
        const [moved] = pages.splice(from, 1);
        if (!moved) return state;
        pages.splice(to, 0, moved);
        return { ...state, pages };
      }

      case "deletePage": {
        const pages = state.pages.filter((p) => p.id !== action.id);
        if (pages.length === state.pages.length) return state;
        const home = state.home_page_id === action.id ? (pages[0]?.id ?? null) : state.home_page_id;
        return { pages, home_page_id: home };
      }

      case "setHome":
        return state.pages.some((p) => p.id === action.id) ? { ...state, home_page_id: action.id } : state;

      case "addWidget":
        return mapPage(state, action.pageId, (page) => {
          if (page.widgets.some((w) => w.id === action.widgetId)) return page;
          const spec = specFor(action.widgetType);
          const layouts: Page["layouts"] = {};
          for (const bp of BREAKPOINTS) {
            layouts[bp] = appendItem(bp, page.layouts[bp] ?? [], action.widgetId, spec);
          }
          return {
            ...page,
            widgets: [
              ...page.widgets,
              { id: action.widgetId, type: action.widgetType, settings: action.settings ?? {} },
            ],
            layouts,
          };
        });

      case "removeWidget":
        return mapPage(state, action.pageId, (page) => {
          if (!page.widgets.some((w) => w.id === action.widgetId)) return page;
          const layouts: Page["layouts"] = {};
          for (const bp of BREAKPOINTS) {
            layouts[bp] = (page.layouts[bp] ?? []).filter((it) => it.i !== action.widgetId);
          }
          return { ...page, widgets: page.widgets.filter((w) => w.id !== action.widgetId), layouts };
        });

      case "updateSettings":
        return mapPage(state, action.pageId, (page) => ({
          ...page,
          widgets: page.widgets.map((w) =>
            w.id === action.widgetId ? { ...w, settings: { ...w.settings, ...action.patch } } : w,
          ),
        }));

      case "setBreakpointLayout":
        return mapPage(state, action.pageId, (page) => {
          const known = new Set(page.widgets.map((w) => w.id));
          const items = action.items
            .filter((it) => known.has(it.i))
            .map(({ i, x, y, w, h }) => ({ i, x, y, w, h }));
          // On ne touche qu'à ce point de rupture : les autres dispositions restent distinctes.
          return sanitizePage({ ...page, layouts: { ...page.layouts, [action.bp]: items } }, specFor);
        });

      case "resetBreakpoint":
        return mapPage(state, action.pageId, (page) => ({
          ...page,
          layouts: {
            ...page.layouts,
            [action.bp]: packDefault(
              action.bp,
              page.widgets.map((w) => ({ id: w.id, spec: specFor(w.type) })),
            ),
          },
        }));
    }
  };
}
