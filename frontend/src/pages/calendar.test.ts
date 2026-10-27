import { describe, expect, it } from "vitest";
import { NO_PLAN_COLOR, PLAN_COLORS, parseDate, parseView, periodTitle, planColor, rangeFor, shiftDate, weekCount } from "./calendar";

describe("calendrier : périodes", () => {
  it("la semaine va du lundi au dimanche", () => {
    expect(rangeFor("semaine", "2026-10-27")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(rangeFor("semaine", "2026-10-26")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
    expect(rangeFor("semaine", "2026-11-01")).toEqual({ from: "2026-10-26", to: "2026-11-01" });
  });

  it("le mois est complété jusqu'au lundi précédent et au dimanche suivant (jamais plus de 62 jours)", () => {
    expect(rangeFor("mois", "2026-10-15")).toEqual({ from: "2026-09-28", to: "2026-11-01" });
    expect(rangeFor("mois", "2026-02-10")).toEqual({ from: "2026-01-26", to: "2026-03-01" });
    expect(rangeFor("mois", "2026-06-30")).toEqual({ from: "2026-06-01", to: "2026-07-05" });
    expect(weekCount("2026-09-28", "2026-11-01")).toBe(5);
    expect(weekCount("2026-10-26", "2026-11-01")).toBe(1);
    for (let m = 1; m <= 12; m += 1) {
      const { from, to } = rangeFor("mois", `2026-${String(m).padStart(2, "0")}-15`);
      expect(weekCount(from, to)).toBeLessThanOrEqual(6);
    }
  });

  it("avance et recule d'une semaine ou d'un mois, y compris en changeant d'année", () => {
    expect(shiftDate("semaine", "2026-10-27", 1)).toBe("2026-11-03");
    expect(shiftDate("semaine", "2026-01-03", -1)).toBe("2025-12-27");
    expect(shiftDate("mois", "2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDate("mois", "2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftDate("mois", "2026-01-15", -1)).toBe("2025-12-01");
    expect(shiftDate("mois", "2026-03-31", -1)).toBe("2026-02-01");
  });

  it("repli sur les valeurs par défaut quand l'adresse est invalide", () => {
    expect(parseDate("2026-02-30", "2026-10-27")).toBe("2026-10-27");
    expect(parseDate("n'importe quoi", "2026-10-27")).toBe("2026-10-27");
    expect(parseDate(null, "2026-10-27")).toBe("2026-10-27");
    expect(parseDate("2026-11-10", "2026-10-27")).toBe("2026-11-10");
    expect(parseView("mois")).toBe("mois");
    expect(parseView("autre")).toBe("semaine");
    expect(parseView(null)).toBe("semaine");
  });

  it("titres lisibles", () => {
    expect(periodTitle("mois", "2026-10-27")).toBe("octobre 2026");
    expect(periodTitle("semaine", "2026-10-27")).toBe("Semaine du 26 octobre au 1 novembre");
  });

  it("une couleur stable par plan, grise sans plan", () => {
    expect(planColor(null)).toBe(NO_PLAN_COLOR);
    expect(planColor(3)).toBe(planColor(3));
    expect(planColor(1)).not.toBe(planColor(2));
    expect(planColor(PLAN_COLORS.length)).toBe(planColor(0));
  });
});
