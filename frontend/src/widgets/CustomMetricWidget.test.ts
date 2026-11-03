import { describe, expect, it } from "vitest";
import { aggregate, MEASURES } from "./CustomMetricWidget";

const rows = [
  { day: "2026-10-26", value: 10 }, // lundi
  { day: "2026-10-28", value: 20 },
  { day: "2026-11-02", value: 5 }, // lundi suivant
  { day: "2026-11-03", value: null },
];

describe("aggregate", () => {
  it("additionne par semaine sans trou", () => {
    const out = aggregate(rows, "2026-10-19", "2026-11-03", "week", "sum");
    expect(out.map((b) => [b.start, b.value])).toEqual([
      ["2026-10-19", null],
      ["2026-10-26", 30],
      ["2026-11-02", 5],
    ]);
  });

  it("moyenne et maximum par mois", () => {
    expect(aggregate(rows, "2026-10-01", "2026-11-03", "month", "mean").map((b) => b.value)).toEqual([15, 5]);
    expect(aggregate(rows, "2026-10-01", "2026-11-03", "month", "max").map((b) => b.value)).toEqual([20, 5]);
  });

  it("un seau par jour", () => {
    expect(aggregate(rows, "2026-11-01", "2026-11-03", "day", "sum").map((b) => b.value)).toEqual([null, 5, null]);
  });
});

describe("MEASURES", () => {
  it("n'expose aucun score maison", () => {
    expect(Object.keys(MEASURES)).not.toContain("score");
  });
});
