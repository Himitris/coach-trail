import { describe, expect, it } from "vitest";
import { rankLabels } from "./StravaSegmentsWidget";

describe("rankLabels", () => {
  it("KOM 1er, top 10 et records perso", () => {
    expect(rankLabels({ kom_rank: 1, pr_rank: 1 })).toEqual(["KOM / QOM", "Record perso"]);
    expect(rankLabels({ kom_rank: 4, pr_rank: null })).toEqual(["Top 10 · 4e"]);
    expect(rankLabels({ kom_rank: null, pr_rank: 2 })).toEqual(["Perso · 2e"]);
    expect(rankLabels({ kom_rank: null, pr_rank: null })).toEqual([]);
  });
});
