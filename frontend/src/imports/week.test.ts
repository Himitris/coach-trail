import { describe, expect, it } from "vitest";
import { addDays, expandWeekTemplate, mondayOf, weekdayIndex } from "./week";

describe("semaine type", () => {
  it("trouve le lundi de la semaine", () => {
    expect(mondayOf("2026-10-28")).toBe("2026-10-26"); // mercredi
    expect(mondayOf("2026-10-26")).toBe("2026-10-26"); // lundi
    expect(mondayOf("2026-11-01")).toBe("2026-10-26"); // dimanche
    expect(addDays("2026-10-26", 7)).toBe("2026-11-02");
  });

  it("accepte les noms de jours sans tenir compte de la casse ni des accents", () => {
    expect(weekdayIndex("Lundi")).toBe(0);
    expect(weekdayIndex(" DIMANCHE ")).toBe(6);
    expect(weekdayIndex("jeudy")).toBe(-1);
  });

  it("convertit les jours en dates de la semaine choisie", () => {
    const { sessions, errors } = expandWeekTemplate(
      [{ jour: "mardi", type: "footing", duree_min: 50 }, { jour: "dimanche", type: "longue" }],
      "2026-11-02",
    );
    expect(errors).toEqual([]);
    expect(sessions).toEqual([
      { date: "2026-11-03", type: "footing", duree_min: 50 },
      { date: "2026-11-08", type: "longue" },
    ]);
  });

  it("signale un jour inconnu au lieu de le deviner", () => {
    const { errors } = expandWeekTemplate([{ jour: "someday", type: "repos" }], "2026-11-02");
    expect(errors[0]).toMatch(/Ligne 1.*« jour »/);
  });
});
