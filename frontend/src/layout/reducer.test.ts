import { describe, expect, it } from "vitest";
import { defaultLayout } from "./defaults";
import type { DashboardLayout, SizeSpec } from "./model";
import { createReducer, MAX_PAGE_TITLE, type LayoutAction } from "./reducer";

const SPECS: Record<string, SizeSpec> = {
  note: { w: 4, h: 3, minW: 2, minH: 2 },
  big: { w: 12, h: 5, minW: 6, minH: 3 },
};
const reducer = createReducer((type) => SPECS[type] ?? { w: 4, h: 4, minW: 2, minH: 2 });

function run(actions: LayoutAction[], from: DashboardLayout = { pages: [], home_page_id: null }) {
  return actions.reduce(reducer, from);
}

const withPage = (): DashboardLayout => run([{ type: "addPage", id: "p1", title: "Accueil" }]);

describe("pages", () => {
  it("la première page créée devient l'accueil, pas les suivantes", () => {
    const state = run([
      { type: "addPage", id: "a", title: "A" },
      { type: "addPage", id: "b", title: "B" },
    ]);
    expect(state.pages.map((p) => p.id)).toEqual(["a", "b"]);
    expect(state.home_page_id).toBe("a");
  });

  it("donne un titre par défaut et ignore un identifiant déjà pris", () => {
    const state = run([{ type: "addPage", id: "a" }, { type: "addPage", id: "b", title: "  " }]);
    expect(state.pages.map((p) => p.title)).toEqual(["Page 1", "Page 2"]);
    expect(reducer(state, { type: "addPage", id: "a", title: "Doublon" })).toBe(state);
  });

  it("renomme en nettoyant le titre, ignore un titre vide, limite la longueur", () => {
    const base = withPage();
    expect(reducer(base, { type: "renamePage", id: "p1", title: "  Trail  " }).pages[0]?.title).toBe("Trail");
    expect(reducer(base, { type: "renamePage", id: "p1", title: "   " })).toBe(base);
    const long = reducer(base, { type: "renamePage", id: "p1", title: "x".repeat(200) });
    expect(long.pages[0]?.title).toHaveLength(MAX_PAGE_TITLE);
    expect(reducer(base, { type: "renamePage", id: "inconnue", title: "Z" })).toBe(base);
  });

  it("duplique une page à la suite de l'originale, sans la rendre accueil", () => {
    let state = run([
      { type: "addPage", id: "a", title: "A" },
      { type: "addPage", id: "b", title: "B" },
      { type: "addWidget", pageId: "a", widgetId: "w1", widgetType: "note", settings: { text: "x" } },
    ]);
    state = reducer(state, { type: "duplicatePage", id: "a", newId: "a2" });
    expect(state.pages.map((p) => p.id)).toEqual(["a", "a2", "b"]);
    expect(state.pages[1]?.title).toBe("A (copie)");
    expect(state.home_page_id).toBe("a");
    expect(state.pages[1]?.widgets[0]?.settings).toEqual({ text: "x" });
    // la copie est indépendante de l'original
    state = reducer(state, { type: "updateSettings", pageId: "a2", widgetId: "w1", patch: { text: "y" } });
    expect(state.pages[0]?.widgets[0]?.settings).toEqual({ text: "x" });
    expect(state.pages[1]?.widgets[0]?.settings).toEqual({ text: "y" });
    expect(reducer(state, { type: "duplicatePage", id: "a", newId: "b" })).toBe(state);
  });

  it("réordonne les pages en bornant l'index", () => {
    const base = run([
      { type: "addPage", id: "a" },
      { type: "addPage", id: "b" },
      { type: "addPage", id: "c" },
    ]);
    const ids = (s: DashboardLayout) => s.pages.map((p) => p.id).join("");
    expect(ids(reducer(base, { type: "movePage", id: "a", toIndex: 2 }))).toBe("bca");
    expect(ids(reducer(base, { type: "movePage", id: "c", toIndex: 0 }))).toBe("cab");
    expect(ids(reducer(base, { type: "movePage", id: "b", toIndex: 99 }))).toBe("acb");
    expect(ids(reducer(base, { type: "movePage", id: "b", toIndex: -5 }))).toBe("bac");
    expect(reducer(base, { type: "movePage", id: "b", toIndex: 1 })).toBe(base);
  });

  it("supprime une page ; l'accueil passe à la première restante, puis à rien", () => {
    const base = run([
      { type: "addPage", id: "a" },
      { type: "addPage", id: "b" },
    ]);
    const afterA = reducer(base, { type: "deletePage", id: "a" });
    expect(afterA.pages.map((p) => p.id)).toEqual(["b"]);
    expect(afterA.home_page_id).toBe("b");
    expect(reducer(base, { type: "deletePage", id: "b" }).home_page_id).toBe("a");
    expect(reducer(afterA, { type: "deletePage", id: "b" })).toEqual({ pages: [], home_page_id: null });
    expect(reducer(base, { type: "deletePage", id: "zzz" })).toBe(base);
  });

  it("désigne la page d'accueil (page connue uniquement)", () => {
    const base = run([{ type: "addPage", id: "a" }, { type: "addPage", id: "b" }]);
    expect(reducer(base, { type: "setHome", id: "b" }).home_page_id).toBe("b");
    expect(reducer(base, { type: "setHome", id: "zzz" })).toBe(base);
  });
});

describe("widgets", () => {
  it("ajoute un widget à chaque point de rupture, en bas, à la taille adaptée à l'écran", () => {
    const state = run([
      { type: "addWidget", pageId: "p1", widgetId: "w1", widgetType: "note" },
      { type: "addWidget", pageId: "p1", widgetId: "w2", widgetType: "note" },
    ], withPage());
    const { layouts, widgets } = state.pages[0] ?? { layouts: {}, widgets: [] };
    expect(widgets.map((w) => w.id)).toEqual(["w1", "w2"]);
    expect(layouts.lg).toEqual([
      { i: "w1", x: 0, y: 0, w: 4, h: 3 },
      { i: "w2", x: 0, y: 3, w: 4, h: 3 },
    ]);
    expect(layouts.md?.[0]).toMatchObject({ w: 3 }); // 4/12 de 8 colonnes, arrondi au-dessus
    expect(layouts.sm?.[0]).toMatchObject({ w: 4 }); // téléphone : pleine largeur
  });

  it("ignore un identifiant de widget déjà présent ou une page inconnue", () => {
    const state = reducer(withPage(), { type: "addWidget", pageId: "p1", widgetId: "w1", widgetType: "note" });
    expect(reducer(state, { type: "addWidget", pageId: "p1", widgetId: "w1", widgetType: "big" })).toBe(state);
    expect(reducer(state, { type: "addWidget", pageId: "?", widgetId: "w9", widgetType: "note" })).toBe(state);
  });

  it("supprime un widget et ses positions partout", () => {
    const base = run([
      { type: "addWidget", pageId: "p1", widgetId: "w1", widgetType: "note" },
      { type: "addWidget", pageId: "p1", widgetId: "w2", widgetType: "big" },
      { type: "removeWidget", pageId: "p1", widgetId: "w1" },
    ], withPage());
    const page = base.pages[0];
    expect(page?.widgets.map((w) => w.id)).toEqual(["w2"]);
    for (const bp of ["lg", "md", "sm"] as const) {
      expect(page?.layouts[bp]?.map((i) => i.i)).toEqual(["w2"]);
    }
    expect(reducer(base, { type: "removeWidget", pageId: "p1", widgetId: "absent" })).toBe(base);
  });

  it("fusionne les réglages", () => {
    const state = run([
      { type: "addWidget", pageId: "p1", widgetId: "w1", widgetType: "note", settings: { text: "a", fontSize: "normal" } },
      { type: "updateSettings", pageId: "p1", widgetId: "w1", patch: { text: "b" } },
    ], withPage());
    expect(state.pages[0]?.widgets[0]?.settings).toEqual({ text: "b", fontSize: "normal" });
  });
});

describe("dispositions par point de rupture", () => {
  const base = (): DashboardLayout =>
    run([
      { type: "addWidget", pageId: "p1", widgetId: "w1", widgetType: "note" },
      { type: "addWidget", pageId: "p1", widgetId: "w2", widgetType: "note" },
    ], withPage());

  it("déplacer sur ordinateur ne change ni la tablette ni le téléphone", () => {
    const before = base().pages[0];
    const state = reducer(base(), {
      type: "setBreakpointLayout",
      pageId: "p1",
      bp: "lg",
      items: [
        { i: "w1", x: 6, y: 0, w: 6, h: 3 },
        { i: "w2", x: 0, y: 0, w: 6, h: 3 },
      ],
    });
    const after = state.pages[0];
    expect(after?.layouts.lg?.[0]).toEqual({ i: "w1", x: 6, y: 0, w: 6, h: 3 });
    expect(after?.layouts.md).toEqual(before?.layouts.md);
    expect(after?.layouts.sm).toEqual(before?.layouts.sm);
  });

  it("garde des dispositions différentes téléphone / ordinateur", () => {
    let state = base();
    state = reducer(state, { type: "setBreakpointLayout", pageId: "p1", bp: "sm", items: [
      { i: "w2", x: 0, y: 0, w: 4, h: 3 },
      { i: "w1", x: 0, y: 3, w: 4, h: 3 },
    ] });
    const layouts = state.pages[0]?.layouts;
    expect(layouts?.sm?.map((i) => i.i)).toEqual(["w2", "w1"]);
    expect(layouts?.lg?.map((i) => i.i)).toEqual(["w1", "w2"]);
  });

  it("filtre les widgets inconnus, retire les propriétés superflues et reste dans la grille", () => {
    const state = reducer(base(), {
      type: "setBreakpointLayout",
      pageId: "p1",
      bp: "sm",
      items: [
        { i: "w1", x: 3, y: 0, w: 9, h: 3, minW: 2, static: true } as never,
        { i: "fantome", x: 0, y: 0, w: 1, h: 1 },
        { i: "w2", x: 0, y: 3, w: 4, h: 3 },
      ],
    });
    const sm = state.pages[0]?.layouts.sm;
    expect(sm).toEqual([
      { i: "w1", x: 0, y: 0, w: 4, h: 3 }, // 9 colonnes demandées sur 4 : ramené à 4, x recalé
      { i: "w2", x: 0, y: 3, w: 4, h: 3 },
    ]);
  });

  it("réinitialise un seul point de rupture", () => {
    let state = base();
    const custom = [
      { i: "w1", x: 8, y: 5, w: 3, h: 2 },
      { i: "w2", x: 0, y: 9, w: 3, h: 2 },
    ];
    state = reducer(state, { type: "setBreakpointLayout", pageId: "p1", bp: "lg", items: custom });
    state = reducer(state, { type: "setBreakpointLayout", pageId: "p1", bp: "sm", items: [
      { i: "w1", x: 0, y: 7, w: 4, h: 2 },
      { i: "w2", x: 0, y: 0, w: 4, h: 2 },
    ] });
    const reset = reducer(state, { type: "resetBreakpoint", pageId: "p1", bp: "sm" });
    expect(reset.pages[0]?.layouts.sm).toEqual([
      { i: "w1", x: 0, y: 0, w: 4, h: 3 },
      { i: "w2", x: 0, y: 3, w: 4, h: 3 },
    ]);
    expect(reset.pages[0]?.layouts.lg?.[0]).toMatchObject({ x: 8, y: 5 }); // ordinateur intact
    const resetLg = reducer(state, { type: "resetBreakpoint", pageId: "p1", bp: "lg" });
    expect(resetLg.pages[0]?.layouts.lg).toEqual([
      { i: "w1", x: 0, y: 0, w: 4, h: 3 },
      { i: "w2", x: 4, y: 0, w: 4, h: 3 }, // rangés en ligne de gauche à droite
    ]);
  });
});

describe("remplacement et défauts", () => {
  it("replace adopte tel quel la disposition fournie", () => {
    const layout = defaultLayout("home");
    expect(reducer({ pages: [], home_page_id: null }, { type: "replace", layout })).toBe(layout);
  });
});
