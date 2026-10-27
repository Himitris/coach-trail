import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DayPlan, RangePlan } from "../api/types";
import { addDays } from "../app/format";
import { day, match, planned } from "../test/fixtures";
import { mockApi, type RecordedCall } from "../test/mockApi";
import { renderWithApp } from "../test/render";
import { CalendarPage } from "./CalendarPage";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 27, 12)); // mardi 27 octobre 2026
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const WEEKDAYS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** Faux serveur : un jour par date demandée, avec quelques séances aux dates connues. */
function range({ query }: RecordedCall): { body: RangePlan } {
  const { from = "", to = "" } = query;
  const days: DayPlan[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const weekday = WEEKDAYS[(new Date(d).getUTCDay() + 6) % 7] ?? "";
    const base = { date: d, weekday, is_today: d === "2026-10-27" };
    if (d === "2026-10-27") {
      days.push(
        day({
          ...base,
          status: "fait",
          sessions: [
            match({
              planned: planned({ id: 1, date: d, titre: "Footing facile", plan_id: 1, plan_nom: "Fin de prépa", objectif: "Endurance", consignes: "Allure conversationnelle." }),
              status: "fait",
              activity: { id: 5, sport: "trail_running", start_utc: "2026-10-27T06:00:00", duration_min: 66, distance_km: 12.8, dplus_m: 130, hr_avg: 140, is_race: false },
              duration_delta_min: 6,
            }),
          ],
        }),
      );
    } else if (d === "2026-11-03") {
      days.push(day({ ...base, status: "à venir", sessions: [match({ planned: planned({ id: 2, date: d, titre: "Seuil 3 × 8", type: "seuil", type_label: "Seuil", plan_id: 2, plan_nom: "Prépa Bruniquel" }) })] }));
    } else if (d === "2026-10-29") {
      days.push(day({ ...base, status: "imprévu", unplanned_activities: [{ id: 9, sport: "cycling", start_utc: "2026-10-29T06:00:00", duration_min: 45, distance_km: 20, dplus_m: 100, hr_avg: 120, is_race: false }] }));
    } else {
      days.push(day(base));
    }
  }
  return {
    body: {
      start: from,
      end: to,
      days,
      races: from <= "2026-11-08" && "2026-11-08" <= to ? [{ id: 1, nom: "Trail des 3 Rocs", date: "2026-11-08" }] : [],
      plans: [{ id: 1, nom: "Fin de prépa" }],
    },
  };
}

const mount = (url = "/calendrier") =>
  renderWithApp(
    <MemoryRouter initialEntries={[url]}>
      <CalendarPage />
    </MemoryRouter>,
  );

const rangeCalls = (api: ReturnType<typeof mockApi>) => api.callsTo("GET /api/plan/range").map((c) => `${c.query.from}→${c.query.to}`);

describe("Calendrier", () => {
  it("affiche la semaine en cours, la séance, la légende et le détail du jour", async () => {
    const api = mockApi({ "GET /api/plan/range": range });
    mount();
    expect(await screen.findByRole("grid")).toBeInTheDocument();
    expect(rangeCalls(api)).toEqual(["2026-10-26→2026-11-01"]);
    expect(screen.getAllByRole("gridcell")).toHaveLength(7);
    expect(screen.getByRole("heading", { level: 2, name: /Semaine du 26 octobre au 1 novembre/ })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Légende" })).getByText(/Fin de prépa/)).toBeInTheDocument();

    const tuesday = screen.getByRole("gridcell", { name: /mar\. 27 oct\./ });
    expect(tuesday).toHaveAccessibleName(/1 séance\(s\) prévue\(s\) : Footing facile \(fait\)/);
    expect(within(tuesday).getByText(/Footing facile/)).toBeInTheDocument();
    expect(screen.getByRole("gridcell", { name: /jeu\. 29 oct\./ })).toHaveAccessibleName(/1 sortie\(s\) non prévue\(s\)/);

    // le jour courant est détaillé d'emblée
    const detail = screen.getByRole("region", { name: /Détail du/ });
    expect(within(detail).getByText("Footing facile")).toBeInTheDocument();
    expect(within(detail).getByText(/Objectif :/)).toBeInTheDocument();
    expect(within(detail).getByText(/Allure conversationnelle/)).toBeInTheDocument();
    expect(within(detail).getByText(/plan : Fin de prépa/)).toBeInTheDocument();
    expect(within(detail).getByText(/Réalisé : Trail · 1 h 06 · 12,8 km/)).toBeInTheDocument();
    expect(within(detail).getByText("fait", { selector: ".chip" })).toBeInTheDocument();
  });

  it("navigue de semaine en semaine et revient à aujourd'hui", async () => {
    const api = mockApi({ "GET /api/plan/range": range });
    mount();
    await screen.findByRole("grid");
    await userEvent.click(screen.getByRole("button", { name: "Semaine suivante" }));
    await waitFor(() => { expect(rangeCalls(api)).toContain("2026-11-02→2026-11-08"); });
    expect(await screen.findByRole("heading", { level: 2, name: /Semaine du 2 novembre au 8 novembre/ })).toBeInTheDocument();
    expect(await screen.findByText(/⚑ Trail des 3 Rocs/, { selector: ".cal-race" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Légende" })).getByText(/Trail des 3 Rocs · 8 nov\./)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Semaine précédente" }));
    await userEvent.click(screen.getByRole("button", { name: "Semaine précédente" }));
    await waitFor(() => { expect(rangeCalls(api)).toContain("2026-10-19→2026-10-25"); });
    await userEvent.click(screen.getByRole("button", { name: "Aujourd'hui" }));
    expect(await screen.findByRole("heading", { level: 2, name: /Semaine du 26 octobre/ })).toBeInTheDocument();
  });

  it("vue mois : période complétée, navigation de mois en mois, jours hors mois atténués", async () => {
    const api = mockApi({ "GET /api/plan/range": range });
    mount();
    await screen.findByRole("grid");
    await userEvent.click(screen.getByRole("button", { name: "Mois" }));
    await waitFor(() => { expect(rangeCalls(api)).toContain("2026-09-28→2026-11-01"); });
    expect(await screen.findByRole("heading", { level: 2, name: "octobre 2026" })).toBeInTheDocument();
    await waitFor(() => { expect(screen.getAllByRole("gridcell")).toHaveLength(35); });
    expect(screen.getAllByRole("row")).toHaveLength(6); // en-tête + 5 semaines
    expect(screen.getByRole("gridcell", { name: /lun\. 28 sept\./ })).toHaveClass("cal-outside");
    expect(screen.getByRole("gridcell", { name: /mar\. 27 oct\./ })).not.toHaveClass("cal-outside");

    await userEvent.click(screen.getByRole("button", { name: "Mois suivant" }));
    await waitFor(() => { expect(rangeCalls(api)).toContain("2026-10-26→2026-12-06"); });
    expect(await screen.findByRole("heading", { level: 2, name: "novembre 2026" })).toBeInTheDocument();
    expect(await screen.findByText(/Seuil 3 × 8/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Mois précédent" }));
    await waitFor(() => { expect(rangeCalls(api).filter((r) => r === "2026-09-28→2026-11-01")).toHaveLength(2); });
  });

  it("la vue et la date viennent de l'adresse", async () => {
    const api = mockApi({ "GET /api/plan/range": range });
    mount("/calendrier?vue=mois&date=2026-11-10");
    expect(await screen.findByRole("heading", { level: 2, name: "novembre 2026" })).toBeInTheDocument();
    expect(rangeCalls(api)).toEqual(["2026-10-26→2026-12-06"]);
    // sans jour courant dans la période, aucun détail tant qu'on n'a rien choisi
    expect(screen.queryByRole("region", { name: /Détail du/ })).toBeNull();
  });

  it("un clic ou le clavier choisit un jour ; les flèches se déplacent dans la grille", async () => {
    mockApi({ "GET /api/plan/range": range });
    mount();
    await screen.findByRole("grid");
    const wednesday = screen.getByRole("gridcell", { name: /mer\. 28 oct\./ });
    await userEvent.click(wednesday);
    expect(wednesday).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("region", { name: /Détail du mer\. 28 oct\./ })).toHaveTextContent("Rien de prévu ni de réalisé ce jour-là.");

    fireEvent.keyDown(wednesday, { key: "ArrowRight" });
    await waitFor(() => { expect(screen.getByRole("gridcell", { name: /jeu\. 29 oct\./ })).toHaveAttribute("aria-selected", "true"); });
    expect(screen.getByRole("region", { name: /Détail du jeu\./ })).toHaveTextContent("Sortie non prévue");
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /jeu\. 29 oct\./ }), { key: "ArrowDown" }); // hors période : ignoré
    expect(screen.getByRole("gridcell", { name: /jeu\. 29 oct\./ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("gridcell", { name: /jeu\. 29 oct\./ }), { key: "ArrowLeft" });
    await waitFor(() => { expect(wednesday).toHaveAttribute("aria-selected", "true"); });
    // un seul jour est atteignable au clavier à la fois
    expect(screen.getAllByRole("gridcell").filter((c) => c.tabIndex === 0)).toHaveLength(1);
    fireEvent.keyDown(wednesday, { key: "Enter" });
    expect(wednesday).toHaveAttribute("aria-selected", "true");
  });

  it("modifier une séance ou en ajouter une ouvre le même formulaire que le widget", async () => {
    const api = mockApi({
      "GET /api/plan/range": range,
      "PUT /api/plan/sessions/1": ({ body }) => ({ body: { ...(body as object), id: 1, type_label: "Footing", status: "fait", plan_id: 1, plan_nom: "Fin de prépa" } }),
    });
    mount();
    await screen.findByRole("grid");
    await userEvent.click(screen.getByRole("button", { name: "Modifier Footing facile" }));
    const dialog = await screen.findByRole("dialog", { name: "Modifier la séance" });
    await userEvent.clear(within(dialog).getByLabelText("Titre"));
    await userEvent.type(within(dialog).getByLabelText("Titre"), "Footing long");
    await userEvent.click(within(dialog).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => { expect(api.callsTo("PUT /api/plan/sessions/1")[0]?.body).toMatchObject({ titre: "Footing long", date: "2026-10-27" }); });
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    // l'enregistrement relit le calendrier
    await waitFor(() => { expect(api.callsTo("GET /api/plan/range").length).toBeGreaterThan(1); });

    await userEvent.click(screen.getByRole("button", { name: "+ Ajouter une séance" }));
    expect(await screen.findByRole("dialog", { name: "Nouvelle séance" })).toBeInTheDocument();
  });

  it("erreur de lecture : message et bouton Réessayer", async () => {
    let fail = true;
    mockApi({
      "GET /api/plan/range": (call) => (fail ? { status: 500, body: { detail: "boom" } } : range(call)),
    });
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Impossible de lire le calendrier/);
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByRole("grid")).toBeInTheDocument();
  });
});
