import { describe, expect, it } from "vitest";
import type { SegmentEffort } from "../api/endpoints";
import { byMonth, groupBySegment, rankLabels } from "./StravaSegmentsWidget";

const effort = (over: Partial<SegmentEffort>): SegmentEffort => ({
  segment_id: 1, name: "Montée", distance_m: 800, grade_pct: 8, elapsed_s: 300, date: "2026-10-30",
  activity_id: 1, kom_rank: null, pr_rank: null, ...over,
}); // fmt: skip

describe("rankLabels", () => {
  it("KOM 1er, top 10 et records perso", () => {
    expect(rankLabels({ kom_rank: 1, pr_rank: 1 })).toEqual(["KOM / QOM", "Record perso"]);
    expect(rankLabels({ kom_rank: 4, pr_rank: null })).toEqual(["Top 10 · 4e"]);
    expect(rankLabels({ kom_rank: null, pr_rank: 2 })).toEqual(["Perso · 2e"]);
    expect(rankLabels({ kom_rank: null, pr_rank: null })).toEqual([]);
  });
});

describe("groupBySegment", () => {
  it("regroupe un segment, garde le meilleur rang et trie les temps par date", () => {
    const groups = groupBySegment([
      effort({ pr_rank: 2, elapsed_s: 320, date: "2026-10-22" }),
      effort({ pr_rank: 1, elapsed_s: 300, date: "2026-10-30" }),
      effort({ segment_id: 2, name: "Crête", kom_rank: 3, date: "2026-09-01" }),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Crête", "Montée"]); // meilleur classement général d'abord
    const montee = groups[1];
    expect(montee?.bestPr).toBe(1);
    expect(montee?.count).toBe(2);
    expect(montee?.lastDate).toBe("2026-10-30");
    expect(montee?.times.map((t) => t.s)).toEqual([320, 300]);
  });
});

describe("byMonth", () => {
  it("compte par mois sur la période, mois vides compris", () => {
    const rows = byMonth(
      [effort({ kom_rank: 5, date: "2026-10-30" }), effort({ pr_rank: 1, date: "2026-10-02" }), effort({ pr_rank: 1, date: "2026-08-15" })],
      4,
      "2026-11-03",
    );
    expect(rows.map((r) => r.month)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(rows.map((r) => [r.kom, r.pr])).toEqual([[0, 1], [0, 0], [1, 1], [0, 0]]);
  });
});
