import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { day, match, planned, totals, weekMetrics, weekPlan } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderWithApp, widgetProps } from "../test/render";
import "./WeekLoadWidget";
import "./WeekPlanWidget";
import { WeekLoadWidget } from "./WeekLoadWidget";
import { WeekPlanWidget } from "./WeekPlanWidget";

afterEach(() => {
  vi.unstubAllGlobals();
});

const brief = {
  id: 7,
  sport: "trail_running",
  start_utc: "2026-10-27T06:00:00",
  duration_min: 66,
  distance_km: 12.8,
  dplus_m: 130,
  hr_avg: 140,
  is_race: false,
};

describe("Programme de la semaine", () => {
  const plan = () =>
    weekPlan([
      { status: "fait", sessions: [match({ planned: planned({ id: 1, date: "2026-10-26", titre: "Repos", type: "repos", type_label: "Repos", duree_min: null, zone_cible: null, dplus_cible: null }), status: "fait" })] },
      {
        is_today: true,
        status: "fait",
        sessions: [
          match({
            planned: planned({ id: 2, titre: "Footing facile", consignes: "Allure conversationnelle." }),
            status: "fait",
            activity: brief,
            duration_delta_min: 6,
            dplus_delta_m: 30,
          }),
        ],
      },
      { status: "à venir", sessions: [match({ planned: planned({ id: 3, date: "2026-10-28", titre: "Seuil 3 × 8 min", type: "seuil", type_label: "Seuil" }) })] },
      { status: "imprévu", unplanned_activities: [{ ...brief, id: 9, sport: "cycling" }] },
    ]);

  it("met en avant le jour, affiche les statuts et le réalisé à côté du prévu", async () => {
    mockApi({ "GET /api/plan/week": () => ({ body: plan() }) });
    renderWithApp(<WeekPlanWidget />);
    const today = await screen.findByRole("region", { name: "mardi" });
    expect(within(today).getByText(/Aujourd'hui/)).toBeInTheDocument();
    expect(within(today).getByText("Footing facile")).toBeInTheDocument();
    expect(within(today).getByText(/Trail · 1 h 06 · 12,8 km · D\+ 130 m/)).toBeInTheDocument();
    expect(within(today).getByText(/\+6 min vs prévu · D\+ \+30 m/)).toBeInTheDocument();
    expect(within(today).getByText("Footing facile :", { exact: false })).toBeInTheDocument(); // consignes du jour
    expect(within(today).getAllByText("fait").length).toBeGreaterThan(0);
    // le jour et sa séance portent chacun leur statut, écrit en toutes lettres
    expect(within(screen.getByRole("region", { name: "mercredi" })).getAllByText("à venir", { selector: ".chip" })).toHaveLength(2);
    const thursday = screen.getByRole("region", { name: "jeudi" });
    expect(within(thursday).getByText("Sortie non prévue")).toBeInTheDocument();
    expect(within(thursday).getAllByText("imprévu")).toHaveLength(2); // jour + sortie
    expect(screen.getByRole("region", { name: "vendredi" })).toHaveTextContent("rien de prévu");
    expect(document.querySelector(".plan-summary")).toHaveTextContent(/prévu\s+7\s?h\s?45\s+·\s+réalisé\s+1\s?h\s?06/);
  });

  it("un clic sur une séance prévue l'ouvre et enregistre les modifications", async () => {
    const api = mockApi({
      "GET /api/plan/week": () => ({ body: plan() }),
      "PUT /api/plan/sessions/3": ({ body }) => ({ body: { ...(body as object), id: 3, type_label: "Seuil", status: "à venir" } }),
    });
    renderWithApp(<WeekPlanWidget />);
    await userEvent.click(await screen.findByRole("button", { name: /Seuil 3 × 8 min/ }));
    const dialog = screen.getByRole("dialog", { name: "Modifier la séance" });
    const title = within(dialog).getByLabelText("Titre");
    expect(title).toHaveValue("Seuil 3 × 8 min");
    await userEvent.clear(title);
    await userEvent.type(title, "Seuil 4 × 6 min");
    await userEvent.clear(within(dialog).getByLabelText("Durée (min)"));
    await userEvent.type(within(dialog).getByLabelText("Durée (min)"), "75");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => { expect(api.callsTo("PUT /api/plan/sessions/3")).toHaveLength(1); });
    expect(api.callsTo("PUT /api/plan/sessions/3")[0]?.body).toMatchObject({
      date: "2026-10-28",
      titre: "Seuil 4 × 6 min",
      type: "seuil",
      duree_min: 75,
    });
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
  });

  it("crée une séance sur un jour et affiche l'erreur de l'API", async () => {
    const api = mockApi({
      "GET /api/plan/week": () => ({ body: plan() }),
      "POST /api/plan/sessions": () => ({ status: 422, body: { detail: "Titre invalide" } }),
    });
    renderWithApp(<WeekPlanWidget />);
    await userEvent.click(await screen.findByRole("button", { name: /Ajouter une séance le vendredi/ }));
    const dialog = screen.getByRole("dialog", { name: "Nouvelle séance" });
    expect(within(dialog).getByLabelText("Date")).toHaveValue("2026-10-30");
    await userEvent.type(within(dialog).getByLabelText("Titre"), "Footing");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Titre invalide");
    expect(api.callsTo("POST /api/plan/sessions")).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Annuler" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("supprime une séance après confirmation", async () => {
    const api = mockApi({
      "GET /api/plan/week": () => ({ body: plan() }),
      "DELETE /api/plan/sessions/3": () => ({ status: 204 }),
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithApp(<WeekPlanWidget />);
    await userEvent.click(await screen.findByRole("button", { name: /Seuil 3 × 8 min/ }));
    await userEvent.click(screen.getByRole("button", { name: "Supprimer" }));
    await waitFor(() => { expect(api.callsTo("DELETE /api/plan/sessions/3")).toHaveLength(1); });
    expect(confirm).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("état vide : message et bouton pour ajouter une séance", async () => {
    mockApi({ "GET /api/plan/week": () => ({ body: weekPlan([], { planned_min: 0, done_min: 0 }) }) });
    renderWithApp(<WeekPlanWidget />);
    expect(await screen.findByText("Aucune séance prévue ni réalisée cette semaine.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Ajouter une séance" })).toBeInTheDocument();
  });

  it("état d'erreur : message de l'API et bouton Réessayer", async () => {
    let fail = true;
    mockApi({
      "GET /api/plan/week": () => (fail ? { status: 500, body: { detail: "Base indisponible" } } : { body: plan() }),
    });
    renderWithApp(<WeekPlanWidget />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Base indisponible");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("region", { name: "mardi" })).toBeInTheDocument();
  });

  it("n'invente rien : une semaine sans séance réalisée affiche des tirets", async () => {
    mockApi({
      "GET /api/plan/week": () => ({ body: weekPlan([{}, { sessions: [match()], status: "à venir", is_today: true }]) }),
    });
    renderWithApp(<WeekPlanWidget />);
    const today = await screen.findByRole("region", { name: "mardi" });
    expect(within(today).getByText("—")).toBeInTheDocument();
    expect(day().sessions).toEqual([]);
  });
});

describe("Charge de la semaine", () => {
  it("compare à la semaine précédente et à la moyenne, avec le repère +10 % comme simple repère", async () => {
    mockApi({ "GET /api/metrics/week": () => ({ body: weekMetrics() }) });
    renderWithApp(<WeekLoadWidget {...widgetProps({ week: "current" })} />);
    expect(await screen.findByText(/Semaine du 19 oct\. au 25 oct\./)).toBeInTheDocument();
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    const time = rows.find((r) => within(r).queryByRole("rowheader", { name: "Temps" }));
    expect(time).toHaveTextContent(/3\s?h\s?00/);
    expect(time).toHaveTextContent(/2\s?h\s?30/); // semaine précédente
    expect(time).toHaveTextContent(/\+20\s%/);
    expect(time).toHaveTextContent(/\+41\s%/);
    expect(screen.getByText(/Temps vs semaine précédente/)).toHaveTextContent(/\+20\s%/);
    expect(screen.getByText(/pas un seuil ni un prédicteur de blessure/)).toBeInTheDocument();
    expect(screen.getByText("mesure")).toBeInTheDocument(); // niveau de preuve
    expect(screen.queryByText(/danger|alerte|risque de blessure élevé/i)).toBeNull();
  });

  it("semaine en cours : jamais de pourcentage trompeur (−100 %)", async () => {
    mockApi({
      "GET /api/metrics/week": () => ({
        body: weekMetrics({
          complete: false,
          current: totals({ time_s: 0, distance_m: 0, gain_m: 0, loss_m: 0, sessions: 0, gain_per_km: null }),
          time_change_vs_previous_pct: -100,
          exceeds_reference: null,
        }),
      }),
    });
    renderWithApp(<WeekLoadWidget {...widgetProps({ week: "current" })} />);
    expect(await screen.findByText("en cours")).toBeInTheDocument();
    expect(screen.queryByText(/−100/)).toBeNull();
    expect(screen.getByText(/n'a de sens qu'une fois la semaine terminée/)).toBeInTheDocument();
  });

  it("choisir « dernière semaine terminée » interroge la semaine précédente", async () => {
    const api = mockApi({ "GET /api/metrics/week": () => ({ body: weekMetrics() }) });
    renderWithApp(<WeekLoadWidget {...widgetProps({ week: "last" })} />);
    await screen.findByRole("table");
    expect(api.callsTo("GET /api/metrics/week")[0]?.query.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("charge perçue (sRPE) affichée seulement s'il y en a", async () => {
    mockApi({
      "GET /api/metrics/week": () => ({
        body: weekMetrics({ srpe: { total_load_au: 480, entries: 2, evidence: { level: "etabli", summary: "x" } } }),
      }),
    });
    renderWithApp(<WeekLoadWidget {...widgetProps({ week: "current" })} />);
    expect(await screen.findByText(/480 u\.a\./)).toBeInTheDocument();
  });

  it("vide : aucune sortie sur les dernières semaines", async () => {
    const none = totals({ time_s: 0, distance_m: 0, gain_m: 0, loss_m: 0, sessions: 0, gain_per_km: null });
    mockApi({ "GET /api/metrics/week": () => ({ body: weekMetrics({ current: none, previous: none, avg_4w: null }) }) });
    renderWithApp(<WeekLoadWidget {...widgetProps({ week: "current" })} />);
    expect(await screen.findByText("Aucune sortie enregistrée sur les dernières semaines.")).toBeInTheDocument();
  });

  it("erreur : message affiché", async () => {
    mockApi({ "GET /api/metrics/week": () => ({ status: 500, body: { detail: "Panne" } }) });
    renderWithApp(<WeekLoadWidget {...widgetProps({ week: "current" })} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Panne");
  });
});

