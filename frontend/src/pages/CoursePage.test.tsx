import { describe, expect, it } from "vitest";
import { buildAgenda, carbsPerHour, dayLabel, elapsedMinutes, raceMarkdown, relativeDay, totalsOf, zoneNumber } from "../race/logic";
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

  it("construit la feuille de route chronologique avec les dates", () => {
    const full: RacePlanDoc = {
      version: 1,
      jours_avant: [
        { jour: -1, titre: "Veille", repas: [{ heure: "19:30", description: "Dîner" }, { heure: "12:30", description: "Déjeuner" }], sommeil: "Tôt" },
        { jour: -2, activite: "Footing" },
      ],
      matin: { reveil: "05:30", depart: "08:00", repas: [{ heure: "05:45", description: "Petit-déj" }] },
      apres_course: { notes: ["Manger"] },
    };
    const groups = buildAgenda("2026-11-08", full);
    expect(groups.map((g) => [g.id, g.date])).toEqual([["j-2", "2026-11-06"], ["j-1", "2026-11-07"], ["matin", "2026-11-08"], ["apres", "2026-11-08"]]);
    expect(groups[1]?.items.map((i) => i.text)).toEqual(["Déjeuner", "Dîner", "Tôt"]);
    expect(groups[2]?.items.map((i) => i.kind)).toEqual(["reveil", "repas", "depart"]);
  });

  it("n'écrit pas « Veille · Veille » et nomme les jours relatifs", () => {
    expect(dayLabel({ jour: -1, titre: "Veille" })).toBe("Veille");
    expect(dayLabel({ jour: -3, titre: "Charger" })).toBe("J-3 · Charger");
    expect(relativeDay("2026-11-05", "2026-11-05")).toBe("aujourd'hui");
    expect(relativeDay("2026-11-06", "2026-11-05")).toBe("demain");
  });

  it("lit la zone et le temps écoulé", () => {
    expect(zoneNumber("Z2-Z3")).toBe(3);
    expect(zoneNumber("facile")).toBeNull();
    expect(elapsedMinutes("2026-11-08", "08:00", new Date(2026, 10, 8, 9, 30))).toBe(90);
    expect(elapsedMinutes("2026-11-08", undefined, new Date())).toBeNull();
  });
});
