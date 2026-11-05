import { describe, expect, it } from "vitest";
import { carbsPerHour, raceMarkdown, totalsOf } from "../race/logic";
import type { RacePlanDoc } from "../race/types";
import { toolActive } from "../app/navigation";
import { defaultGoal } from "./CoursePage";

const doc: RacePlanDoc = {
  version: 1,
  tranches: [
    { debut_min: 0, fin_min: 60, zone: "Z2", fc_min: 135, fc_max: 150, glucides_g: 60, gels: 1, boisson_ml: 500 },
    { debut_min: 60, fin_min: 150, glucides_g: 90, gels: 1.5 },
  ],
  jours_avant: [{ jour: -1, repas: [{ heure: "19:30", description: "Pâtes", glucides_g: 120 }] }],
};

describe("plan de course", () => {
  it("cumule la nutrition et calcule les g/h", () => {
    expect(totalsOf(doc.tranches ?? [])).toEqual({ minutes: 150, carbs: 150, gels: 2.5, drinkMl: 500, sodiumMg: 0 });
    expect(carbsPerHour(doc.tranches?.[1] ?? { debut_min: 0, fin_min: 1 })).toBe(60);
  });

  it("exporte en Markdown avec la veille et le tableau", () => {
    const md = raceMarkdown("3 Rocs", "2026-11-08", doc);
    expect(md).toContain("## Veille");
    expect(md).toContain("Pâtes (120 g glucides)");
    expect(md).toContain("| 0 h 00 → 1 h 00 |  | Z2 | 135–150 |");
    expect(md).toContain("Total : 150 g de glucides, 2.5 gel(s)");
  });

  it("choisit la prochaine course, sinon la dernière", () => {
    const g = (id: number, date: string) => ({ id, nom: `c${id}`, date, distance_km: null, dplus_m: null, priorite: 1, profil_points: null });
    expect(defaultGoal([g(1, "2026-11-08"), g(2, "2027-02-14")], "2026-11-09")?.id).toBe(2);
    expect(defaultGoal([g(1, "2026-11-08")], "2027-01-01")?.id).toBe(1);
  });

  it("n'active pas « Plans & courses » sur /course", () => {
    expect(toolActive("/course", "/courses")).toBe(false);
    expect(toolActive("/courses", "/course")).toBe(false);
    expect(toolActive("/course", "/course")).toBe(true);
  });
});

