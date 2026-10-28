import { describe, expect, it } from "vitest";
import { fitRowHeight } from "./WidgetGrid";

describe("fitRowHeight", () => {
  it("répartit la hauteur disponible entre les lignes, marges comprises", () => {
    // 10 lignes, 8 px de marge entre elles : (800 − 9 × 8) / 10 = 72
    expect(fitRowHeight(10, 800)).toBe(72);
  });
  it("ne descend pas sous un minimum lisible (la page défile alors)", () => {
    expect(fitRowHeight(40, 600)).toBe(44);
  });
  it("plafonne les lignes quand il y a peu de widgets", () => {
    expect(fitRowHeight(2, 1000)).toBe(220);
  });
  it("garde la hauteur par défaut si la hauteur disponible est inconnue", () => {
    expect(fitRowHeight(8, undefined)).toBe(72);
    expect(fitRowHeight(8, 0)).toBe(72);
  });
});
