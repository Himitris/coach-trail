import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, todayIso } from "../app/format";
import { entry, fitness, intensity, recovery, trend, wellness } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderWithApp, widgetProps } from "../test/render";
import { daysFor, FitnessWidget, nextGoal, raceDays } from "./FitnessWidget";
import { IntensityWidget, toBarRows, weeksFor } from "./IntensityWidget";
import { RecoveryWidget, rollingMean } from "./RecoveryWidget";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Répartition des intensités", () => {
  it("barres par semaine, cible 75–80 %, moyenne et dernière semaine sans jugement", async () => {
    const api = mockApi({ "GET /api/metrics/intensity": () => ({ body: intensity() }) });
    renderWithApp(<IntensityWidget {...widgetProps({ period: "12w" })} />);
    expect(await screen.findByText(/Moyenne sur la période/)).toHaveTextContent(/75\s%\sen bas d'intensité/);
    expect(api.callsTo("GET /api/metrics/intensity")[0]?.query.weeks).toBe("12");
    expect(document.querySelectorAll(".recharts-bar-rectangle").length).toBeGreaterThan(0);
    const legend = screen.getByRole("list", { name: "Légende des zones" });
    expect(within(legend).getByText(/Cible 75–80 % en zones 1–2/)).toBeInTheDocument();
    expect(screen.getByText(/dernière semaine \(du 19 oct\.\)/)).toHaveTextContent(/80\s%/);
    expect(screen.getByText(/1 course\(s\) exclue\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/Zones 1–2 Garmin/)).toBeInTheDocument();
    expect(screen.getByText("indicatif")).toBeInTheDocument();
  });

  it("indique l'écart à la fourchette en points, sans le qualifier", async () => {
    const report = intensity();
    const last = report.weeks[1];
    if (last) Object.assign(last, { low_share_pct: 68, delta_to_target_pct: -7 });
    mockApi({ "GET /api/metrics/intensity": () => ({ body: report }) });
    renderWithApp(<IntensityWidget {...widgetProps({ period: "8w" })} />);
    expect(await screen.findByText(/−7\spoints par rapport à la fourchette/)).toBeInTheDocument();
    expect(screen.queryByText(/mauvais|bien|insuffisant|trop/i)).toBeNull();
  });

  it("vide quand aucune FC n'a été enregistrée ; erreur sinon", async () => {
    const empty = intensity();
    for (const w of empty.weeks) Object.assign(w, { hr_time_s: 0, zone_seconds: [0, 0, 0, 0, 0, 0], low_share_pct: null });
    mockApi({ "GET /api/metrics/intensity": () => ({ body: empty }) });
    const { unmount } = renderWithApp(<IntensityWidget {...widgetProps({ period: "8w" })} />);
    expect(await screen.findByText("Aucune donnée de fréquence cardiaque sur la période.")).toBeInTheDocument();
    unmount();
    mockApi({ "GET /api/metrics/intensity": () => ({ status: 500, body: { detail: "Panne" } }) });
    renderWithApp(<IntensityWidget {...widgetProps({ period: "8w" })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Panne");
  });

  it("toBarRows : parts du temps avec FC, « sous zone 1 » rangé en zone 1, semaine vide à zéro", () => {
    const rows = toBarRows([
      { week_start: "2026-10-12", week_end: "2026-10-18", zone_seconds: [100, 300, 400, 100, 100, 0], hr_time_s: 1000, low_share_pct: 80, delta_to_target_pct: 0, activities_counted: 1, activities_without_hr_stream: 0, races_excluded: 0 },
      { week_start: "2026-10-19", week_end: "2026-10-25", zone_seconds: [0, 0, 0, 0, 0, 0], hr_time_s: 0, low_share_pct: null, delta_to_target_pct: null, activities_counted: 0, activities_without_hr_stream: 0, races_excluded: 0 },
    ]);
    expect(rows[0]).toMatchObject({ z1: 40, z2: 40, z3: 10, z4: 10, z5: 0, empty: false });
    expect(rows[1]).toMatchObject({ z1: 0, z2: 0, z3: 0, z4: 0, z5: 0, empty: true });
    expect(weeksFor("26w")).toBe(26);
    expect(weeksFor("n'importe quoi")).toBe(8);
    expect(weeksFor("900w")).toBe(52);
  });
});

describe("Forme (CTL / ATL / TSB)", () => {
  const goals = [
    { id: 1, nom: "Trail des 3 Rocs", date: addDays(todayIso(), 12), distance_km: 31, dplus_m: 1600, priorite: 1 },
  ];

  it("affiche CTL, ATL, TSB, la rampe et le compte à rebours, avec « tendance, pas un verdict »", async () => {
    const api = mockApi({
      "GET /api/metrics/fitness": () => ({ body: fitness() }),
      "GET /api/goals": () => ({ body: goals }),
      "GET /api/activities": () => ({ body: [] }),
    });
    renderWithApp(<FitnessWidget {...widgetProps({ period: "26w" })} />);
    expect(await screen.findByText("CTL (forme chronique)")).toBeInTheDocument();
    expect(screen.getByText("CTL (forme chronique)").nextSibling).toHaveTextContent("49,9");
    expect(screen.getByText("TSB (CTL − ATL)").nextSibling).toHaveTextContent("−2,0");
    expect(screen.getByText("Rampe CTL sur 4 sem.").nextSibling).toHaveTextContent("+3,2");
    expect(screen.getByText(/Courbes de tendance .*pas un verdict/)).toBeInTheDocument();
    const goal = (await screen.findByText("Trail des 3 Rocs")).closest("p");
    expect(goal).toHaveTextContent(/Prochain objectif : Trail des 3 Rocs le .* — dans 12 jours/);
    expect(document.querySelectorAll(".recharts-line").length).toBeGreaterThanOrEqual(2);
    const query = api.callsTo("GET /api/metrics/fitness")[0]?.query;
    expect(query?.to).toBe(todayIso());
    expect(query?.from).toBe(addDays(todayIso(), 26 * 7 * -1));
  });

  it("montre les avertissements du calcul (historique court, seuil estimé)", async () => {
    mockApi({
      "GET /api/metrics/fitness": () => ({
        body: fitness({ warnings: ["Seuil lactique absent du profil : estimé à 88 % de la FC max.", "Moins de 42 jours d'historique."] }),
      }),
      "GET /api/goals": () => ({ body: [] }),
      "GET /api/activities": () => ({ body: [] }),
    });
    renderWithApp(<FitnessWidget {...widgetProps({ period: "13w" })} />);
    expect(await screen.findByText(/Seuil lactique absent du profil/)).toBeInTheDocument();
    expect(screen.getByText(/Moins de 42 jours/)).toBeInTheDocument();
  });

  it("sans donnée de charge : état vide, pas de courbe plate inventée", async () => {
    mockApi({
      "GET /api/metrics/fitness": () => ({ body: fitness({ points: [], ctl_ramp_4w: null }) }),
      "GET /api/goals": () => ({ body: [] }),
      "GET /api/activities": () => ({ body: [] }),
    });
    renderWithApp(<FitnessWidget {...widgetProps({ period: "26w" })} />);
    expect(await screen.findByText(/la courbe de forme ne peut pas être calculée/)).toBeInTheDocument();
    expect(document.querySelectorAll(".recharts-wrapper")).toHaveLength(0);
  });

  it("erreur : message affiché", async () => {
    mockApi({
      "GET /api/metrics/fitness": () => ({ status: 500, body: { detail: "Panne" } }),
      "GET /api/goals": () => ({ body: [] }),
      "GET /api/activities": () => ({ body: [] }),
    });
    renderWithApp(<FitnessWidget {...widgetProps({ period: "26w" })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Panne");
  });

  it("jours de course et prochain objectif", () => {
    const g = [
      { id: 1, nom: "Trail des 3 Rocs", date: "2026-11-08", distance_km: 31, dplus_m: 1600, priorite: 1 },
      { id: 2, nom: "Bruniquel", date: "2027-02-15", distance_km: 39, dplus_m: null, priorite: 2 },
    ];
    expect(raceDays(g, ["2026-09-20", "2026-11-08", "2025-01-01"], "2026-05-01", "2026-11-30")).toEqual([
      { date: "2026-09-20", label: "Course" },
      { date: "2026-11-08", label: "Trail des 3 Rocs" }, // l'objectif prime sur « Course »
    ]);
    expect(nextGoal(g, "2026-10-27")).toMatchObject({ days: 12, goal: { nom: "Trail des 3 Rocs" } });
    expect(nextGoal(g, "2026-11-08")?.days).toBe(0);
    expect(nextGoal(g, "2027-03-01")).toBeNull();
    expect(daysFor("26w")).toBe(182);
    expect(daysFor("x")).toBe(182);
  });
});

describe("Récupération", () => {
  const routes = (rec = recovery(), series = wellness()) => ({
    "GET /api/metrics/recovery": () => ({ body: rec }),
    "GET /api/metrics/wellness": () => ({ body: series }),
  });

  it("HRV, FC repos et sommeil face à la base, avis Garmin étiquetés, aucun feu vert/rouge", async () => {
    const api = mockApi(routes());
    renderWithApp(<RecoveryWidget {...widgetProps({ window: "28", baseline: "45" })} />);
    const hrv = (await screen.findByText(/HRV · moyenne 7 j/)).closest(".stat") as HTMLElement;
    expect(hrv).toHaveTextContent("66 ms");
    expect(hrv).toHaveTextContent(/base 60 j : 60 ± 4,1 ms/);
    expect(hrv).toHaveTextContent(/\+10,0\s%/);
    expect(hrv).toHaveTextContent(/\+1,5 écart-type/);
    expect(hrv).toHaveTextContent("↗ en hausse");
    expect(api.callsTo("GET /api/metrics/recovery")[0]?.query.days).toBe("45");
    expect(api.callsTo("GET /api/metrics/wellness")[0]?.query.days).toBe("28");

    const readiness = screen.getByText("Training Readiness").closest(".stat") as HTMLElement;
    expect(readiness).toHaveTextContent("54");
    expect(readiness).toHaveTextContent("avis Garmin, non validé");
    expect(within(screen.getByText("Avis de la montre").parentElement as HTMLElement).getAllByText("avis Garmin, non validé").length).toBe(3);

    expect(screen.getByText(/pas de feu vert ni de feu rouge/)).toBeInTheDocument();
    expect(document.querySelectorAll(".recharts-wrapper").length).toBe(1); // courbe HRV
    expect(screen.getByText(/plage de référence Garmin \(54–70 ms/)).toBeInTheDocument();
    expect(screen.queryByText("ACWR (Garmin)")).toBeNull(); // jamais calculé ici
  });

  it("l'ACWR n'apparaît que comme valeur Garmin « non validé »", async () => {
    mockApi(routes(recovery({ acwr: { value: 1.3, date: "2026-10-27", label: "non validé", evidence: { level: "non_valide", summary: "Aucune alerte." } } })));
    renderWithApp(<RecoveryWidget {...widgetProps({ window: "28", baseline: "60" })} />);
    const card = (await screen.findByText("ACWR (Garmin)")).closest(".stat") as HTMLElement;
    expect(card).toHaveTextContent("1,30");
    expect(card).toHaveTextContent("non validé");
    expect(card).toHaveClass("stat-grey");
  });

  it("données insuffisantes : pas de tendance affichée", async () => {
    const thin = recovery({
      hrv: { ...recovery().hrv, sufficient: false, recent_n: 2, baseline_n: 8, delta_sd: null, trend: trend("indetermine") },
    });
    mockApi(routes(thin));
    renderWithApp(<RecoveryWidget {...widgetProps({ window: "28", baseline: "60" })} />);
    const hrv = (await screen.findByText(/HRV · moyenne 7 j/)).closest(".stat") as HTMLElement;
    expect(hrv).toHaveTextContent("Données insuffisantes pour une tendance (2 nuits récentes, 8 jours de base)");
    expect(hrv).not.toHaveTextContent("écart-type");
  });

  it("valeurs absentes : tirets, jamais zéro", async () => {
    const noReadiness = recovery({
      training_readiness: { ...recovery().training_readiness, value: null, date: null },
    });
    mockApi(routes(noReadiness));
    renderWithApp(<RecoveryWidget {...widgetProps({ window: "28", baseline: "60" })} />);
    const card = (await screen.findByText("Training Readiness")).closest(".stat") as HTMLElement;
    expect(card).toHaveTextContent("—");
  });

  it("vide : aucune donnée reçue ; erreur : message", async () => {
    mockApi(routes(recovery(), wellness({ points: [] })));
    const { unmount } = renderWithApp(<RecoveryWidget {...widgetProps({ window: "28", baseline: "60" })} />);
    expect(await screen.findByText(/Aucune donnée de récupération reçue/)).toBeInTheDocument();
    unmount();
    mockApi({ ...routes(), "GET /api/metrics/recovery": () => ({ status: 500, body: { detail: "Panne" } }) });
    renderWithApp(<RecoveryWidget {...widgetProps({ window: "28", baseline: "60" })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Panne");
  });

  it("rollingMean : moyenne glissante calendaire, null sous 3 valeurs", () => {
    const pts = [
      { date: "2026-10-01", value: 60 },
      { date: "2026-10-02", value: 62 },
      { date: "2026-10-03", value: 64 },
      { date: "2026-10-04", value: null },
      { date: "2026-10-12", value: 70 }, // trou de plusieurs jours
    ];
    const out = rollingMean(pts);
    expect(out[0]).toBeNull(); // 1 seule valeur
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(62); // (60 + 62 + 64) / 3
    expect(out[3]).toBeCloseTo(62); // une valeur absente ne compte pas
    expect(out[4]).toBeNull(); // 70 est seul dans sa fenêtre de 7 jours
    expect(entry().malade).toBeNull();
  });
});
