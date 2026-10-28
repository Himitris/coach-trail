import { describe, expect, it } from "vitest";
import { defaultLayout, sanitizeLayout } from "../layout/defaults";
import { BREAKPOINTS } from "../layout/model";
import { getWidget, HOME_WIDGET_TYPES, listWidgets, specFor } from ".";

describe("catalogue des widgets", () => {
  it("les 16 widgets sont enregistrés avec réglages, taille minimale et export", () => {
    const ids = listWidgets().map((w) => w.id).sort();
    expect(ids).toEqual(
      [
        "activity-detail", "evening-entry", "fatigue", "fitness", "fueling", "gear", "intensity", "monotony", "note",
        "race-goal", "recent-activities", "recovery", "strength", "weather", "week-load", "week-plan",
      ].sort(),
    );
    for (const w of listWidgets()) {
      expect(w.title).toBeTruthy();
      expect(w.description).toBeTruthy();
      expect(w.minSize.w).toBeLessThanOrEqual(w.defaultSize.w);
      expect(w.minSize.h).toBeLessThanOrEqual(w.defaultSize.h);
      expect(typeof w.exportData).toBe("function");
      for (const field of w.settingsSchema) {
        if (field.type === "select") {
          // la valeur par défaut doit exister dans les options
          expect(field.options.map((o) => o.value)).toContain(String(w.defaultSettings[field.key]));
        }
      }
    }
  });

  it("l'export de la note libre ne renvoie rien tant qu'elle est vide", async () => {
    const note = getWidget("note");
    expect(await note?.exportData({ text: "  " })).toBeNull();
    expect(await note?.exportData({ text: "salut" })).toEqual({ title: "Note libre", markdown: "## Note libre\n\nsalut\n" });
  });
});

describe("page d'accueil par défaut", () => {
  it("contient programme, charge, dernières sorties, récupération et saisie du soir, placés pour chaque écran", () => {
    expect(HOME_WIDGET_TYPES).toEqual(["week-plan", "week-load", "recent-activities", "recovery", "evening-entry"]);
    const widgets = HOME_WIDGET_TYPES.map((type, i) => ({ id: `w${i}`, type }));
    const layout = sanitizeLayout(defaultLayout("home", widgets, specFor), specFor);
    const page = layout.pages[0];
    expect(page?.title).toBe("Accueil");
    expect(page?.widgets.map((w) => w.type)).toEqual([...HOME_WIDGET_TYPES]);
    for (const bp of BREAKPOINTS) {
      expect(page?.layouts[bp]?.map((i) => i.i)).toEqual(["w0", "w1", "w2", "w3", "w4"]);
    }
    // ordinateur : programme et charge côte à côte ; téléphone : tout en pleine largeur, empilé
    const lg = page?.layouts.lg ?? [];
    expect(lg[0]).toMatchObject({ x: 0, y: 0 });
    expect(lg[0]).toMatchObject({ w: 12 }); // le programme est un bandeau pleine largeur
    expect(lg[1]).toMatchObject({ x: 0, y: 3 });
    const sm = page?.layouts.sm ?? [];
    expect(sm.every((i) => i.x === 0 && i.w === 4)).toBe(true);
    expect(new Set(sm.map((i) => i.y)).size).toBe(5);
  });
});
