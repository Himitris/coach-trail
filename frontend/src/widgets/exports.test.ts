import { describe, expect, it } from "vitest";
import { activity, day, detail, entry, fitness, intensity, match, planned, recovery, totals, weekMetrics, weekPlan } from "../test/fixtures";
import {
  formatActivityDetail,
  formatEntry,
  formatFitness,
  formatIntensity,
  formatRecentActivities,
  formatRecovery,
  formatWeekLoad,
  formatWeekPlan,
} from "./exports";

const n = (s: string): string => s.replace(/[\u202f\u00a0]/g, " ");

describe("exports Markdown des widgets", () => {
  it("programme : tableau jour par jour, réalisé à côté du prévu", () => {
    const md = n(
      formatWeekPlan(
        weekPlan([
          {},
          {
            status: "fait",
            sessions: [
              match({
                planned: planned({ titre: "Footing facile", duree_min: 60, zone_cible: "1-2" }),
                status: "fait",
                activity: { id: 1, sport: "trail_running", start_utc: "x", duration_min: 66, distance_km: 12.8, dplus_m: 130, hr_avg: 140, is_race: false },
              }),
            ],
          },
          { status: "manqué", sessions: [match({ planned: planned({ id: 2, titre: "Seuil", duree_min: 70, zone_cible: "4" }), status: "manqué" })] },
        ]),
      ),
    );
    expect(md).toContain("## Programme de la semaine");
    expect(md).toContain("Prévu : 7 h 45 · Réalisé : 1 h 06");
    expect(md).toMatch(/\| mar\. 27 oct\. \| Footing facile, 1 h 00, Z1-2 \| Trail 1 h 06, 12,8 km, D\+ 130 m \| fait \|/);
    expect(md).toMatch(/\| Seuil, 1 h 10, Z4 \| — \| manqué \|/);
    expect(md).toMatch(/\| lun\. 26 oct\. \| — \| — \| — \|/); // jour sans rien : tirets, rien d'inventé
    expect(day().sessions).toEqual([]);
  });

  it("charge : tableau, variation et repère présenté comme tel", () => {
    const md = n(formatWeekLoad(weekMetrics({ srpe: { total_load_au: 480, entries: 2, evidence: { level: "etabli", summary: "x" } } })));
    expect(md).toMatch(/\| Temps \| 3 h 00 \| 2 h 30 \| 2 h 08 \|/);
    expect(md).toContain("+20 % vs semaine précédente");
    expect(md).toContain("pas un prédicteur de blessure");
    expect(md).toContain("480 u.a.");
    const none = formatWeekLoad(weekMetrics({ avg_4w: null, time_change_vs_avg4w_pct: null, current: totals() }));
    expect(none).toMatch(/\| Temps \| .* \| — \|/);
  });

  it("dernières sorties : GAP seulement s'il existe, valeurs manquantes en tirets", () => {
    const md = n(formatRecentActivities([activity(), activity({ id: 2, distance_km: null, dplus_m: null, hr_avg: null, rpe: null, day: "2026-10-23" })]));
    expect(md).not.toContain("GAP");
    expect(md).toMatch(/\| 25 oct\. \| Trail \| 2 h 05 \| 18,4 km \| 820 m \| 142 \| 6 \|/);
    expect(md).toMatch(/\| 23 oct\. \| Trail \| 2 h 05 \| — \| — \| — \| — \|/);
    expect(formatRecentActivities([activity({ gap_s_per_km: 390 })])).toContain("6:30 /km");
  });

  it("détail : zones, côtes (avec VAM), GAP et NGP ; jamais de valeur inventée", () => {
    const md = n(formatActivityDetail(detail({ gap_s_per_km: 420 })));
    expect(md).toContain("Détail de séance — Trail du 25 oct.");
    expect(md).toContain("allure ajustée à la pente : 7:00 /km, allure normalisée : 7:35 /km");
    expect(md).toMatch(/\| Z3 \| 1 h 00 \| 48 % \|/);
    expect(md).toMatch(/\| 1 \| 0,4–1,5 \| 120 m \| 1 100 m \| 10,9 % \| 9 min \| 152 \| 800 \|/);
    const unknown = n(formatActivityDetail(detail({ gap_s_per_km: null, ngp_s_per_km: null })));
    expect(unknown).toContain("allure ajustée à la pente : non calculable)");
    const bare = formatActivityDetail(detail({ zones: null, climbs: [], stream: null, notes: [] }));
    expect(bare).not.toContain("Temps par zone");
    expect(bare).not.toContain("Côtes détectées");
  });

  it("intensités : parts par zone, cible et courses exclues", () => {
    const md = n(formatIntensity(intensity()));
    expect(md).toContain("| Semaine du | Z1 | Z2 | Z3 | Z4 | Z5 | Bas d'intensité (Z1–Z2) |");
    expect(md).toMatch(/\| 12 oct\. \| 10 % \| 60 % \| 20 % \| 10 % \| 0 % \| 70 % \|/);
    expect(md).toContain("Cible : 75–80 %");
    expect(md).toContain("Courses exclues.");
  });

  it("forme : valeurs du jour, rampe, « pas un verdict » et avertissements ; vide sans données", () => {
    const md = n(formatFitness(fitness({ warnings: ["Historique court."] })));
    expect(md).toContain("CTL 49,9 · ATL 51,9 · TSB −2,0");
    expect(md).toContain("Rampe de CTL sur 4 semaines : +3,2");
    expect(md).toContain("pas un verdict");
    expect(md).toContain("- Historique court.");
    expect(formatFitness(fitness({ points: [] }))).toContain("Aucune donnée de charge");
  });

  it("récupération : tendances sans seuil, avis Garmin étiquetés, tirets si absent", () => {
    const md = n(formatRecovery(recovery()));
    expect(md).toMatch(/\| HRV nocturne \| 66 ms \| 60 ms \| \+10,0 % \| \+1,5 écart-type \| en hausse \|/);
    expect(md).toContain("- Training Readiness : 54 (avis Garmin, non validé)");
    expect(md).toContain("sans seuil quotidien feu vert/rouge");
    const missing = formatRecovery(recovery({ training_readiness: { ...recovery().training_readiness, value: null } }));
    expect(missing).toContain("- Training Readiness : — (avis Garmin, non validé)");
  });

  it("saisie du soir : rien à exporter si rien n'est saisi", () => {
    expect(formatEntry("2026-10-27", null)).toBeNull();
    expect(formatEntry("2026-10-27", entry())).toBeNull();
    const md = formatEntry("2026-10-27", entry({ courbatures: 4, malade: false, note: "ok", sessions: [{ activity_id: 1, rpe: 6, sport: "trail_running", duration_min: 125 }] }));
    expect(md).toContain("RPE 6/10 (Trail, 2 h 05)");
    expect(md).toContain("Courbatures : 4/10");
    expect(md).toContain("Malade : non");
    expect(md).toContain("Note : ok");
  });

  it("échappe les barres verticales dans les tableaux", () => {
    const md = formatWeekPlan(weekPlan([{ sessions: [match({ planned: planned({ titre: "A | B" }) })] }]));
    expect(md).toContain("A / B");
  });
});
