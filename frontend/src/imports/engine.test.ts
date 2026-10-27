import { describe, expect, it } from "vitest";
import { buildGlobalPrompt, GLOBAL_COACH_SENTENCE, GLOBAL_EXAMPLE, splitDocument } from "./engine";
import { listImportSpecs } from "./specs";

const ids = (doc: unknown): string[] => splitDocument(doc).sections.map((s) => s.spec.widgetId);

describe("splitDocument", () => {
  it("l'exemple de l'import unique donne les quatre sections, sans erreur", () => {
    const { sections, errors } = splitDocument(JSON.parse(GLOBAL_EXAMPLE));
    expect(errors).toEqual([]);
    expect(sections.map((s) => s.spec.widgetId)).toEqual(["week-plan", "evening-entry", "race-goal", "gear"].sort((a, b) => ids(JSON.parse(GLOBAL_EXAMPLE)).indexOf(a) - ids(JSON.parse(GLOBAL_EXAMPLE)).indexOf(b)));
    expect(new Set(sections.map((s) => s.spec.widgetId))).toEqual(new Set(["week-plan", "race-goal", "evening-entry", "gear"]));
    const plan = sections.find((s) => s.spec.widgetId === "week-plan")?.doc as Record<string, unknown>;
    expect(plan).toMatchObject({ version: 2, plan: { nom: "Fin de prépa 3 Rocs" } });
    expect(Object.keys(plan).sort()).toEqual(["plan", "sessions", "version"]);
    const goals = sections.find((s) => s.spec.widgetId === "race-goal")?.doc;
    expect(goals).toMatchObject({ version: 1, objectifs: [{ nom: "Trail de Bruniquel" }] });
  });

  it("une liste de séances est un plan ; « courses » est un synonyme d'« objectifs »", () => {
    expect(ids([{ date: "2026-11-03", type: "footing" }])).toEqual(["week-plan"]);
    const { sections } = splitDocument({ version: 2, courses: [{ nom: "X", date: "2026-11-08" }] });
    expect(sections[0]?.spec.widgetId).toBe("race-goal");
    expect(sections[0]?.doc).toEqual({ version: 1, objectifs: [{ nom: "X", date: "2026-11-08" }] });
  });

  it("une semaine type avec un bloc « plan » passe en version 2 ; sans bloc, version 1", () => {
    const withPlan = splitDocument({ plan: { nom: "P" }, semaine_type: [] }).sections[0]?.doc;
    expect(withPlan).toMatchObject({ version: 2, plan: { nom: "P" } });
    expect(splitDocument({ semaine_type: [] }).sections[0]?.doc).toMatchObject({ version: 1 });
  });

  it("signale les clés inconnues, les versions inconnues et les documents vides", () => {
    expect(splitDocument({ version: 3, saisies: [] }).errors[0]).toMatch(/Version non prise en charge/);
    expect(splitDocument({ saisies: [], truc: 1 }).errors[0]).toMatch(/Champ inconnu « truc »/);
    expect(splitDocument({ version: 2 }).errors[0]).toMatch(/aucune section/);
    expect(splitDocument("texte").errors[0]).toMatch(/objet JSON/);
    expect(splitDocument(null).sections).toEqual([]);
  });

  it("la note libre est renvoyée vers le widget Note", () => {
    const { errors } = splitDocument({ saisies: [], note: "x" });
    expect(errors.join(" ")).toMatch(/widget Note/);
    expect(splitDocument({ texte: "x" }).errors.join(" ")).toMatch(/widget Note/);
  });

  it("refuse deux clés synonymes pour la même section", () => {
    expect(splitDocument({ objectifs: [], courses: [] }).errors.join(" ")).toMatch(/Une seule clé/);
  });
});

describe("prompt d'import unique", () => {
  it("reprend le format et les règles de chaque section, et l'exemple complet", () => {
    const prompt = buildGlobalPrompt();
    for (const spec of listImportSpecs().filter((s) => s.widgetId !== "note")) {
      expect(spec.rules.length).toBeGreaterThan(20);
      expect(prompt).toContain(spec.rules);
      expect(prompt).toContain(spec.format);
    }
    expect(prompt).toContain(GLOBAL_EXAMPLE);
    expect(prompt).toContain("« version » (2)");
    expect(prompt).toContain("footing | cotes | seuil | longue"); // les valeurs de « type » sont listées
    expect(prompt).toContain("jamais « jour » ni « semaine_type »");
    expect(GLOBAL_COACH_SENTENCE).toContain(GLOBAL_EXAMPLE);
  });

  it("chaque format de widget garde un prompt et un exemple JSON valides", () => {
    for (const spec of listImportSpecs()) {
      if (!spec.plainText) expect(() => JSON.parse(spec.example) as unknown).not.toThrow();
      expect(spec.sectionKeys.length).toBeGreaterThan(0);
    }
  });
});
