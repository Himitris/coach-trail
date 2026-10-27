import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FatigueReport,
  FuelingSeries,
  MonotonyReport,
  RaceGoalReport,
  StrengthReport,
} from "../api/types";
import { evidence } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderWithApp, widgetProps } from "../test/render";
import { getWidget } from ".";
import { FatigueWidget } from "./FatigueWidget";
import { FuelingWidget } from "./FuelingWidget";
import { MonotonyWidget } from "./MonotonyWidget";
import { parseProfile, RaceGoalWidget } from "./RaceGoalWidget";
import { StrengthWidget } from "./StrengthWidget";

afterEach(() => {
  vi.unstubAllGlobals();
});

const raceGoal = (over: Partial<RaceGoalReport> = {}): RaceGoalReport => ({
  goal_id: 1,
  nom: "Trail des 3 Rocs",
  date: "2026-11-08",
  distance_km: 31,
  dplus_m: 1600,
  days_left: 12,
  profile: [[0, 300], [10, 700], [31, 320]],
  profile_dplus_m: 410,
  recent: {
    window_days: 28,
    distance_km: 140,
    dplus_m: 5200,
    avg_weekly_km: 35,
    avg_weekly_dplus_m: 1300,
    longest_km: 22,
    longest_dplus_m: 900,
    avg_weekly_km_vs_race_pct: 112.9,
    avg_weekly_dplus_vs_race_pct: 81.3,
    longest_km_vs_race_pct: 71,
    longest_dplus_vs_race_pct: 56.3,
    evidence: evidence("indicatif", "Volume récent, repère de préparation."),
  },
  predictions: [{ label: "Semi-marathon", seconds: 5700, note: "estimation de la montre, non validée" }],
  projection: {
    from_date: "2026-10-27",
    race_date: "2026-11-08",
    days: 12,
    scenarios: [
      { name: "Repos complet jusqu'à la course", daily_load: 0, ctl: 40, atl: 20, tsb: 20 },
      { name: "Charge récente maintenue", daily_load: 50, ctl: 46, atl: 52, tsb: -6 },
    ],
    evidence: evidence("indicatif", "Courbe de tendance."),
  },
  ...over,
});

describe("Objectif de course", () => {
  const goals = [
    { id: 1, nom: "Trail des 3 Rocs", date: "2026-11-08", distance_km: 31, dplus_m: 1600, priorite: 1 },
    { id: 2, nom: "Trail de Bruniquel", date: "2027-02-15", distance_km: 39, dplus_m: null, priorite: 2 },
  ];

  it("compte à rebours, volume face à la course, TSB projeté, prédictions étiquetées", async () => {
    mockApi({
      "GET /api/goals": () => ({ body: goals }),
      "GET /api/metrics/race-goal": () => ({ body: raceGoal() }),
    });
    renderWithApp(<RaceGoalWidget {...widgetProps({ goalId: null })} />);
    expect(await screen.findByText("J−12")).toBeInTheDocument();
    const table = screen.getByRole("table");
    const longest = within(table).getByRole("row", { name: /Plus longue sortie/ });
    expect(longest).toHaveTextContent("22,0 km");
    expect(longest).toHaveTextContent("31,0 km");
    expect(longest).toHaveTextContent("71 %");
    expect(screen.getByText(/Repos complet jusqu'à la course : TSB/)).toHaveTextContent("+20,0");
    expect(screen.getByText(/Charge récente maintenue : TSB/)).toHaveTextContent("−6,0");
    expect(screen.getByText(/estimation de la montre, non validée/)).toBeInTheDocument();
    expect(document.querySelectorAll(".recharts-wrapper").length).toBe(1); // profil D+
    expect(screen.getByText("Volume récent, repère de préparation.")).toBeInTheDocument();
  });

  it("choix de l'objectif dans le widget", async () => {
    const updateSettings = vi.fn();
    const api = mockApi({
      "GET /api/goals": () => ({ body: goals }),
      "GET /api/metrics/race-goal": () => ({ body: raceGoal() }),
    });
    renderWithApp(<RaceGoalWidget {...widgetProps({ goalId: null }, updateSettings)} />);
    await userEvent.selectOptions(await screen.findByLabelText("Objectif"), "2");
    expect(updateSettings).toHaveBeenCalledWith({ goalId: 2 });
    expect(api.callsTo("GET /api/metrics/race-goal")[0]?.query.goal_id).toBeUndefined();
  });

  it("sans objectif à venir : état vide ; sans profil : invitation à le saisir", async () => {
    mockApi({
      "GET /api/goals": () => ({ body: [] }),
      "GET /api/metrics/race-goal": () => ({ status: 404, body: { detail: "Aucun objectif de course à venir." } }),
    });
    renderWithApp(<RaceGoalWidget {...widgetProps({ goalId: null })} />);
    expect(await screen.findByText(/Aucun objectif de course à venir/)).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockApi({
      "GET /api/goals": () => ({ body: [] }),
      "GET /api/metrics/race-goal": () => ({ body: raceGoal({ profile: null, profile_dplus_m: null, projection: null, predictions: [] }) }),
    });
    renderWithApp(<RaceGoalWidget {...widgetProps({ goalId: null })} />);
    expect(await screen.findByText(/Profil altimétrique de la course non renseigné/)).toBeInTheDocument();
  });

  it("saisie des points du profil : validée localement puis envoyée", async () => {
    const api = mockApi({
      "GET /api/goals": () => ({ body: [] }),
      "GET /api/metrics/race-goal": () => ({ body: raceGoal({ profile: null, profile_dplus_m: null }) }),
      "PUT /api/goals/1/profile": () => ({ body: goals[0] }),
    });
    renderWithApp(<RaceGoalWidget {...widgetProps({ goalId: null })} />);
    await userEvent.click(await screen.findByText("Ajouter le profil de la course"));
    const box = screen.getByLabelText(/Points « kilomètre;altitude »/);
    await userEvent.type(box, "0;300");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer les points" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Au moins 2 points");
    expect(api.callsTo("PUT /api/goals/1/profile")).toHaveLength(0);
    await userEvent.type(box, "{enter}12,5;820");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer les points" }));
    await waitFor(() => { expect(api.callsTo("PUT /api/goals/1/profile")).toHaveLength(1); });
    expect(api.callsTo("PUT /api/goals/1/profile")[0]?.body).toEqual({ points: [[0, 300], [12.5, 820]] });
  });

  it("import GPX : le contenu du fichier est envoyé au serveur", async () => {
    const api = mockApi({
      "GET /api/goals": () => ({ body: [] }),
      "GET /api/metrics/race-goal": () => ({ body: raceGoal() }),
      "POST /api/goals/1/profile/gpx": () => ({ body: { distance_km: 31, dplus_m: 1600, dminus_m: 1590, points: 120, goal: goals[0] } }),
    });
    const { container } = renderWithApp(<RaceGoalWidget {...widgetProps({ goalId: null })} />);
    await screen.findByText("J−12");
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["<gpx></gpx>"], "trace.gpx", { type: "application/gpx+xml" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve("<gpx></gpx>") });
    await userEvent.upload(input, file);
    await waitFor(() => { expect(api.callsTo("POST /api/goals/1/profile/gpx")).toHaveLength(1); });
    expect(api.callsTo("POST /api/goals/1/profile/gpx")[0]?.body).toEqual({ gpx: "<gpx></gpx>", apply_totals: true });
  });

  it("parseProfile : séparateurs, virgule décimale, erreurs lisibles", () => {
    expect(parseProfile("0;300\n12,5 820\n31\t310")).toEqual({ points: [[0, 300], [12.5, 820], [31, 310]] });
    expect(parseProfile("0;300\n0;310")).toEqual({ error: "Ligne 2 : les kilomètres doivent croître." });
    expect(parseProfile("a;b\n1;2")).toEqual({ error: "Ligne 1 : attendu « kilomètre;altitude »." });
    expect(parseProfile("0;1")).toEqual({ error: "Au moins 2 points sont nécessaires." });
  });

  it("export : Markdown du volume face à la course ; rien sans objectif", async () => {
    mockApi({ "GET /api/metrics/race-goal": () => ({ body: raceGoal() }) });
    const block = await getWidget("race-goal")?.exportData({ goalId: null });
    expect(block?.markdown).toContain("## Objectif de course — Trail des 3 Rocs");
    expect(block?.markdown).toContain("| Plus longue sortie | 22,0 km | 31,0 km | 71 % |");
    expect(block?.markdown).toContain("TSB +20,0");
    vi.unstubAllGlobals();
    mockApi({ "GET /api/metrics/race-goal": () => ({ status: 404, body: { detail: "x" } }) });
    expect(await getWidget("race-goal")?.exportData({ goalId: null })).toBeNull();
  });
});

const fueling = (over: Partial<FuelingSeries> = {}): FuelingSeries => ({
  min_hours: 2.5,
  missing: 1,
  evidence: evidence("indicatif", "L'appli enregistre, elle ne prescrit pas."),
  points: [
    { activity_id: 10, day: "2026-10-04", duration_h: 3, distance_km: 24, entry_id: 1, carbs_g_per_h: 60, carbs_total_g: 180, gi_score: 4, note: null, carbs_change_g_per_h: null },
    { activity_id: 11, day: "2026-10-18", duration_h: 3.5, distance_km: 28, entry_id: 2, carbs_g_per_h: 75, carbs_total_g: 262.5, gi_score: 2, note: null, carbs_change_g_per_h: 15 },
    { activity_id: 12, day: "2026-10-25", duration_h: 4, distance_km: 32, entry_id: null, carbs_g_per_h: null, carbs_total_g: null, gi_score: null, note: null, carbs_change_g_per_h: null },
  ],
  ...over,
});

describe("Nutrition en course", () => {
  it("liste les longues sorties, la progression et celles à saisir ; aucune cible affichée", async () => {
    const api = mockApi({ "GET /api/fueling/series": () => ({ body: fueling() }) });
    renderWithApp(<FuelingWidget {...widgetProps({ minHours: "3" })} />);
    const rows = await screen.findAllByRole("row");
    expect(api.callsTo("GET /api/fueling/series")[0]?.query.min_hours).toBe("3");
    const text = rows.map((r) => r.textContent).join("\n");
    expect(text).toContain("75 g/h");
    expect(text).toContain("+15 g/h");
    expect(text).toMatch(/à saisir/);
    expect(screen.getByText("1 sortie(s) longue(s) sans saisie de nutrition.")).toBeInTheDocument();
    expect(screen.getByText(/elle ne prescrit pas/)).toBeInTheDocument();
    expect(document.querySelectorAll(".recharts-wrapper").length).toBe(1);
  });

  it("saisie rapide : g/h + score digestif, un POST puis la série est relue", async () => {
    let calls = 0;
    const api = mockApi({
      "GET /api/fueling/series": () => ({ body: fueling() }),
      "POST /api/fueling": () => {
        calls += 1;
        return { status: 201, body: {} };
      },
    });
    renderWithApp(<FuelingWidget {...widgetProps({ minHours: "2.5" })} />);
    const row = (await screen.findByRole("row", { name: /25 oct\./ }));
    await userEvent.click(within(row).getByRole("button", { name: "Saisir" }));
    const form = screen.getByRole("form", { name: "Nutrition de la sortie 12" });
    const save = within(form).getByRole("button", { name: "Enregistrer" });
    expect(save).toBeDisabled(); // g/h et score requis
    await userEvent.type(within(form).getByLabelText("Glucides (g/h)"), "80");
    await userEvent.click(within(form).getByRole("button", { name: "Score digestif : 3" }));
    await userEvent.click(save);
    await waitFor(() => { expect(calls).toBe(1); });
    expect(api.callsTo("POST /api/fueling")[0]?.body).toEqual({ activity_id: 12, glucides_g_par_h: 80, score_digestif: 3 });
    await waitFor(() => { expect(api.callsTo("GET /api/fueling/series").length).toBeGreaterThan(1); });
  });

  it("modification et suppression d'une saisie existante", async () => {
    const api = mockApi({
      "GET /api/fueling/series": () => ({ body: fueling() }),
      "PUT /api/fueling/2": () => ({ body: {} }),
      "DELETE /api/fueling/2": () => ({ status: 204 }),
    });
    renderWithApp(<FuelingWidget {...widgetProps({ minHours: "2.5" })} />);
    const row = await screen.findByRole("row", { name: /18 oct\./ });
    await userEvent.click(within(row).getByRole("button", { name: "Modifier" }));
    const form = screen.getByRole("form", { name: "Nutrition de la sortie 11" });
    expect(within(form).getByLabelText("Glucides (g/h)")).toHaveValue(75);
    expect(within(form).getByRole("button", { name: "Score digestif : 2" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.clear(within(form).getByLabelText("Glucides (g/h)"));
    await userEvent.type(within(form).getByLabelText("Glucides (g/h)"), "85");
    await userEvent.click(within(form).getByRole("button", { name: "Mettre à jour" }));
    await waitFor(() => { expect(api.callsTo("PUT /api/fueling/2")).toHaveLength(1); });
    expect(api.callsTo("PUT /api/fueling/2")[0]?.body).toEqual({ glucides_g_par_h: 85, score_digestif: 2 });
    await userEvent.click(within(form).getByRole("button", { name: "Supprimer" }));
    await waitFor(() => { expect(api.callsTo("DELETE /api/fueling/2")).toHaveLength(1); });
  });

  it("erreur du serveur à l'enregistrement : message affiché, valeurs conservées", async () => {
    mockApi({
      "GET /api/fueling/series": () => ({ body: fueling() }),
      "POST /api/fueling": () => ({ status: 409, body: { detail: "Cette sortie a déjà une saisie de nutrition (la modifier)." } }),
    });
    renderWithApp(<FuelingWidget {...widgetProps({ minHours: "2.5" })} />);
    const row = await screen.findByRole("row", { name: /25 oct\./ });
    await userEvent.click(within(row).getByRole("button", { name: "Saisir" }));
    const form = screen.getByRole("form", { name: "Nutrition de la sortie 12" });
    await userEvent.type(within(form).getByLabelText("Glucides (g/h)"), "70");
    await userEvent.click(within(form).getByRole("button", { name: "Score digestif : 1" }));
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer" }));
    expect(await within(form).findByText(/a déjà une saisie/)).toBeInTheDocument();
    expect(within(form).getByLabelText("Glucides (g/h)")).toHaveValue(70);
  });

  it("vide : message ; export Markdown : « non saisi » plutôt qu'une valeur inventée", async () => {
    mockApi({ "GET /api/fueling/series": () => ({ body: fueling({ points: [], missing: 0 }) }) });
    renderWithApp(<FuelingWidget {...widgetProps({ minHours: "2.5" })} />);
    expect(await screen.findByText(/Aucune sortie de plus de 2,5 h/)).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockApi({ "GET /api/fueling/series": () => ({ body: fueling() }) });
    const block = await getWidget("fueling")?.exportData({ minHours: "2.5" });
    expect(block?.markdown).toContain("non saisi");
    expect(block?.markdown).toContain("+15");
  });
});

const monotony = (over: Partial<MonotonyReport> = {}): MonotonyReport => ({
  reference: 2,
  evidence: evidence("indicatif", "Observationnel, petit échantillon, jamais un prédicteur de blessure."),
  weeks: [
    { week_start: "2026-10-12", complete: true, load: 300, monotony: 0.87, strain: 260, high_load: false, soft_alert: false, message: null },
    { week_start: "2026-10-19", complete: false, load: 700, monotony: 2.4, strain: 1680, high_load: true, soft_alert: true, message: "Charge élevée et peu de variation : information seulement." },
  ],
  ...over,
});

describe("Monotonie et tension", () => {
  it("courbe, repère à 2, alerte douce et avertissement « information, pas une prédiction »", async () => {
    mockApi({ "GET /api/metrics/monotony": () => ({ body: monotony() }) });
    renderWithApp(<MonotonyWidget {...widgetProps({ weeks: "12" })} />);
    const stat = (await screen.findByText(/Monotonie \(semaine du/)).closest(".stat") as HTMLElement;
    expect(stat).toHaveTextContent("2,40");
    expect(stat).toHaveTextContent("repère : 2");
    expect(screen.getByText(/Charge élevée et peu de variation : information seulement/)).toBeInTheDocument();
    expect(screen.getByText(/Information, pas une prédiction/)).toBeInTheDocument();
    expect(screen.getByText(/jamais un prédicteur de blessure/)).toBeInTheDocument();
    expect(document.querySelectorAll(".recharts-wrapper").length).toBe(1);
  });

  it("sans alerte : aucune liste d'alertes ; sans donnée : état vide ; erreur : message", async () => {
    mockApi({ "GET /api/metrics/monotony": () => ({ body: monotony({ weeks: [{ week_start: "2026-10-12", complete: true, load: 300, monotony: 0.9, strain: 270, high_load: false, soft_alert: false, message: null }] }) }) });
    renderWithApp(<MonotonyWidget {...widgetProps({ weeks: "8" })} />);
    await screen.findByText(/Monotonie \(semaine du/);
    expect(document.querySelector(".notes")).toBeNull();
    vi.unstubAllGlobals();
    mockApi({ "GET /api/metrics/monotony": () => ({ body: monotony({ weeks: [{ week_start: "2026-10-12", complete: true, load: 0, monotony: null, strain: null, high_load: null, soft_alert: false, message: null }] }) }) });
    renderWithApp(<MonotonyWidget {...widgetProps({ weeks: "8" })} />);
    expect(await screen.findByText(/Aucune charge d'entraînement/)).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockApi({ "GET /api/metrics/monotony": () => ({ status: 500, body: { detail: "panne" } }) });
    renderWithApp(<MonotonyWidget {...widgetProps({ weeks: "8" })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("panne");
  });

  it("les semaines demandées sont transmises et exportées", async () => {
    const api = mockApi({ "GET /api/metrics/monotony": () => ({ body: monotony() }) });
    renderWithApp(<MonotonyWidget {...widgetProps({ weeks: "26" })} />);
    await screen.findByText(/Monotonie \(semaine du/);
    expect(api.callsTo("GET /api/metrics/monotony")[0]?.query.weeks).toBe("26");
    const block = await getWidget("monotony")?.exportData({ weeks: "12" });
    expect(block?.markdown).toContain("| Semaine du | Charge | Monotonie | Tension | Charge élevée | Information |");
    expect(block?.markdown).toContain("Information, pas une prédiction");
  });
});

const fatigue = (over: Partial<FatigueReport> = {}): FatigueReport => ({
  weeks: [
    { week_start: "2026-10-12", complete: true, loss_m: 1500, sessions: 4, strong_sessions: 1 },
    { week_start: "2026-10-19", complete: false, loss_m: 400, sessions: 2, strong_sessions: 0 },
  ],
  strong_sessions: [
    { activity_id: 5, day: "2026-10-14", loss_m: 1100, loss_per_km: 55, soreness_date: "2026-10-16", soreness: 7 },
    { activity_id: 6, day: "2026-10-26", loss_m: 900, loss_per_km: 60, soreness_date: "2999-01-01", soreness: null },
    { activity_id: 7, day: "2026-10-01", loss_m: 850, loss_per_km: null, soreness_date: "2026-10-03", soreness: null },
  ],
  suggestion: { after: "2026-10-26", easy_from: "2026-10-27", easy_until: "2026-10-29", message: "Grosse descente le 2026-10-26 : le repère courant est de 2 à 3 jours faciles. Information, pas une prescription." },
  evidence: evidence("indicatif", "La descente produit l'essentiel du dommage musculaire."),
  ...over,
});

describe("Fatigue musculaire", () => {
  it("D− hebdo, séances à fort D−, courbatures à 48 h, rappel informatif", async () => {
    mockApi({ "GET /api/metrics/fatigue": () => ({ body: fatigue() }) });
    renderWithApp(<FatigueWidget {...widgetProps({ weeks: "8" })} />);
    const note = await screen.findByRole("note");
    expect(note).toHaveTextContent("2 à 3 jours faciles");
    expect(note).toHaveTextContent("Information, pas une prescription");
    const rows = screen.getAllByRole("row");
    const byDay = (label: RegExp) => rows.find((r) => label.test(r.textContent)) as HTMLElement;
    expect(byDay(/14 oct\./)).toHaveTextContent("7/10");
    expect(byDay(/26 oct\./)).toHaveTextContent("à saisir le");
    expect(byDay(/1 oct\./)).toHaveTextContent("non saisi");
    expect(byDay(/1 oct\./)).toHaveTextContent("—"); // D−/km inconnu
    expect(document.querySelectorAll(".recharts-wrapper").length).toBe(1);
  });

  it("sans fort D− : message ; sans sortie : état vide", async () => {
    mockApi({ "GET /api/metrics/fatigue": () => ({ body: fatigue({ strong_sessions: [], suggestion: null }) }) });
    renderWithApp(<FatigueWidget {...widgetProps({ weeks: "8" })} />);
    expect(await screen.findByText(/Aucune séance à fort D− sur la période/)).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
    vi.unstubAllGlobals();
    mockApi({ "GET /api/metrics/fatigue": () => ({ body: fatigue({ weeks: [{ week_start: "2026-10-12", complete: true, loss_m: 0, sessions: 0, strong_sessions: 0 }] }) }) });
    renderWithApp(<FatigueWidget {...widgetProps({ weeks: "8" })} />);
    expect(await screen.findByText("Aucune sortie sur la période.")).toBeInTheDocument();
  });

  it("export Markdown : « non saisi » pour les courbatures absentes", async () => {
    mockApi({ "GET /api/metrics/fatigue": () => ({ body: fatigue() }) });
    const block = await getWidget("fatigue")?.exportData({ weeks: "8" });
    const md = (block?.markdown ?? "").replace(/\s/g, " "); // espaces insécables des nombres
    expect(md).toContain("| 14 oct. | 1 100 m | 55 m/km | 7 |");
    expect(md).toContain("non saisi (3 oct.)");
  });
});

const strength = (over: Partial<StrengthReport> = {}): StrengthReport => ({
  target: 2,
  evidence: evidence("indicatif", "Compteur simple de séances."),
  weeks: [
    { week_start: "2026-10-12", complete: true, detected: 1, manual: 0, count: 1, target: 2, target_met: false },
    { week_start: "2026-10-19", complete: false, detected: 1, manual: 2, count: 2, target: 2, target_met: true },
  ],
  ...over,
});

describe("Renforcement", () => {
  it("compteur hebdomadaire face à l'objectif", async () => {
    mockApi({ "GET /api/metrics/strength": () => ({ body: strength() }) });
    renderWithApp(<StrengthWidget {...widgetProps({ weeks: "8" })} />);
    const counter = await screen.findByLabelText("Séances de renforcement cette semaine");
    expect(counter).toHaveTextContent("2 / 2");
    expect(counter.closest(".stat")).toHaveTextContent("objectif atteint");
    const rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("19 oct.");
    expect(rows[1]).toHaveTextContent("2 ✓");
    expect(rows[2]).toHaveTextContent("12 oct.");
  });

  it("ajout d'une séance du jour et réglage de l'objectif", async () => {
    const api = mockApi({
      "GET /api/metrics/strength": () => ({ body: strength({ target: null }) }),
      "POST /api/strength/sessions": () => ({ status: 201, body: {} }),
      "PUT /api/profile": () => ({ body: {} }),
    });
    renderWithApp(<StrengthWidget {...widgetProps({ weeks: "8" })} />);
    await userEvent.click(await screen.findByRole("button", { name: /Séance de renforcement aujourd'hui/ }));
    await waitFor(() => { expect(api.callsTo("POST /api/strength/sessions")).toHaveLength(1); });
    expect((api.callsTo("POST /api/strength/sessions")[0]?.body as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const input = screen.getByLabelText("Objectif par semaine");
    await userEvent.type(input, "3");
    await userEvent.tab();
    await waitFor(() => { expect(api.callsTo("PUT /api/profile")).toHaveLength(1); });
    expect(api.callsTo("PUT /api/profile")[0]?.body).toEqual({ renfo_objectif_hebdo: 3 });
  });

  it("export Markdown", async () => {
    mockApi({ "GET /api/metrics/strength": () => ({ body: strength() }) });
    const block = await getWidget("strength")?.exportData({ weeks: "8" });
    expect(block?.markdown).toContain("Objectif hebdomadaire : 2");
    expect(block?.markdown).toContain("| 19 oct. (en cours) | 2 | 1 | 2 | oui |");
  });
});
