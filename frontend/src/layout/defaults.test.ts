import { describe, expect, it } from "vitest";
import { defaultLayout, packDefault, sanitizeLayout, sanitizePage, sizeFor } from "./defaults";
import { breakpointForWidth, type Page, type SizeSpec } from "./model";

const spec: SizeSpec = { w: 4, h: 3, minW: 2, minH: 2 };
const specFor = () => spec;

describe("breakpointForWidth", () => {
  it("choisit ordinateur / tablette / téléphone d'après la largeur", () => {
    expect(breakpointForWidth(1400)).toBe("lg");
    expect(breakpointForWidth(1000)).toBe("lg");
    expect(breakpointForWidth(999)).toBe("md");
    expect(breakpointForWidth(640)).toBe("md");
    expect(breakpointForWidth(639)).toBe("sm");
    expect(breakpointForWidth(0)).toBe("sm");
  });
});

describe("sizeFor", () => {
  it("met la largeur à l'échelle des colonnes", () => {
    expect(sizeFor("lg", spec)).toEqual({ w: 4, h: 3, minW: 2, minH: 2 });
    expect(sizeFor("md", spec)).toMatchObject({ w: 3, minW: 2 });
    expect(sizeFor("sm", spec)).toMatchObject({ w: 4, minW: 2 });
    expect(sizeFor("md", { w: 12, h: 4, minW: 12, minH: 1 })).toMatchObject({ w: 8, minW: 8 });
  });
});

describe("packDefault", () => {
  it("range en lignes de gauche à droite puis passe à la ligne", () => {
    const widgets = ["a", "b", "c", "d"].map((id) => ({ id, spec }));
    expect(packDefault("lg", widgets).map(({ i, x, y }) => [i, x, y])).toEqual([
      ["a", 0, 0],
      ["b", 4, 0],
      ["c", 8, 0],
      ["d", 0, 3],
    ]);
    expect(packDefault("sm", widgets).map(({ i, x, y }) => [i, x, y])).toEqual([
      ["a", 0, 0],
      ["b", 0, 3],
      ["c", 0, 6],
      ["d", 0, 9],
    ]);
    expect(packDefault("lg", [])).toEqual([]);
  });
});

describe("sanitizePage", () => {
  const page: Page = {
    id: "p",
    title: "P",
    widgets: [
      { id: "a", type: "note", settings: {} },
      { id: "b", type: "note", settings: {} },
    ],
    layouts: {
      lg: [
        { i: "a", x: 10, y: 0, w: 6, h: 2 }, // déborde à droite
        { i: "a", x: 0, y: 5, w: 2, h: 2 }, // doublon
        { i: "orphan", x: 0, y: 0, w: 1, h: 1 }, // widget supprimé
      ],
    },
  };

  it("ajoute les positions manquantes, retire les orphelines et les doublons, borne dans la grille", () => {
    const clean = sanitizePage(page, specFor);
    expect(clean.layouts.lg).toEqual([
      { i: "a", x: 6, y: 0, w: 6, h: 2 },
      { i: "b", x: 0, y: 2, w: 4, h: 3 },
    ]);
    expect(clean.layouts.md?.map((i) => i.i)).toEqual(["a", "b"]);
    expect(clean.layouts.sm?.map((i) => i.i)).toEqual(["a", "b"]);
  });

  it("est idempotent", () => {
    const once = sanitizePage(page, specFor);
    expect(sanitizePage(once, specFor)).toEqual(once);
  });
});

describe("sanitizeLayout", () => {
  it("corrige une page d'accueil inexistante", () => {
    const layout = sanitizeLayout(
      { pages: [{ id: "x", title: "X", widgets: [], layouts: {} }], home_page_id: "disparue" },
      specFor,
    );
    expect(layout.home_page_id).toBe("x");
    expect(sanitizeLayout({ pages: [], home_page_id: "z" }, specFor).home_page_id).toBeNull();
  });

  it("la disposition par défaut a une page d'accueil vide", () => {
    const layout = defaultLayout("home");
    expect(layout.home_page_id).toBe("home");
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0]).toMatchObject({ title: "Accueil", widgets: [] });
  });
});
