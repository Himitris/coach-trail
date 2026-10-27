import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal, Plan } from "../api/types";
import { mockApi } from "../test/mockApi";
import { renderWithApp } from "../test/render";
import { CoursesPage, daysUntil } from "./CoursesPage";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 27, 12)); // 27 octobre 2026
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const goal = (over: Partial<Goal>): Goal => ({
  id: 1,
  nom: "Trail des 3 Rocs",
  date: "2026-11-08",
  distance_km: 31,
  dplus_m: 1600,
  priorite: 1,
  ...over,
});
const plan = (over: Partial<Plan>): Plan => ({
  id: 10,
  nom: "Fin de prépa",
  date_debut: "2026-10-28",
  date_fin: "2026-11-07",
  goal_id: 1,
  goal_nom: "Trail des 3 Rocs",
  nb_seances: 9,
  ...over,
});
const GOALS = [goal({}), goal({ id: 2, nom: "Trail de Bruniquel", date: "2027-02-14", distance_km: 39, dplus_m: null })];

describe("daysUntil", () => {
  it("compte les jours calendaires, sans effet d'heure d'été", () => {
    expect(daysUntil("2026-11-08", "2026-10-27")).toBe(12);
    expect(daysUntil("2026-10-25", "2026-10-24")).toBe(1); // passage à l'heure d'hiver
    expect(daysUntil("2026-10-20", "2026-10-27")).toBe(-7);
    expect(daysUntil("2026-10-27", "2026-10-27")).toBe(0);
  });
});

describe("Page Courses", () => {
  it("affiche chaque course avec son compte à rebours et le plan attribué", async () => {
    mockApi({
      "GET /api/goals": () => ({ body: GOALS }),
      "GET /api/plans": () => ({ body: [plan({})] }),
    });
    renderWithApp(<CoursesPage />);
    const rocs = await screen.findByRole("article", { name: "Trail des 3 Rocs" });
    expect(within(rocs).getByText("J−12")).toBeInTheDocument();
    expect(within(rocs).getByText(/31,0 km/)).toBeInTheDocument();
    expect(within(rocs).getByText("Fin de prépa")).toBeInTheDocument();
    expect(within(rocs).getByText(/9 séance\(s\)/)).toBeInTheDocument();
    const bruniquel = screen.getByRole("article", { name: "Trail de Bruniquel" });
    expect(within(bruniquel).getByText("Aucun plan pour cette course.")).toBeInTheDocument();
    expect(within(bruniquel).getByText("J−110")).toBeInTheDocument();
  });

  it("attribue un plan sans course à une course, et détache un plan", async () => {
    let plans = [plan({ goal_id: null, goal_nom: null })];
    const api = mockApi({
      "GET /api/goals": () => ({ body: GOALS }),
      "GET /api/plans": () => ({ body: plans }),
      "PUT /api/plans/10/course": ({ body }) => {
        const goalId = (body as { goal_id: number | null }).goal_id;
        const g = GOALS.find((x) => x.id === goalId);
        plans = [plan({ goal_id: goalId, goal_nom: g?.nom ?? null })];
        return { body: plans[0] };
      },
    });
    renderWithApp(<CoursesPage />);
    expect(await screen.findByText("Plans sans course")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Attribuer à une course"), "2");
    await waitFor(() => { expect(api.callsTo("PUT /api/plans/10/course")[0]?.body).toEqual({ goal_id: 2 }); });
    const bruniquel = screen.getByRole("article", { name: "Trail de Bruniquel" });
    await within(bruniquel).findByText("Fin de prépa");
    expect(screen.queryByText("Plans sans course")).toBeNull();

    await userEvent.click(within(bruniquel).getByRole("button", { name: "Détacher" }));
    await waitFor(() => { expect(api.callsTo("PUT /api/plans/10/course")[1]?.body).toEqual({ goal_id: null }); });
    expect(await screen.findByText("Plans sans course")).toBeInTheDocument();
  });

  it("propose d'attribuer à une course un plan déjà pris par une autre", async () => {
    const api = mockApi({
      "GET /api/goals": () => ({ body: GOALS }),
      "GET /api/plans": () => ({ body: [plan({}), plan({ id: 11, nom: "Prépa Bruniquel", goal_id: null, goal_nom: null, date_debut: "2026-11-10", date_fin: "2027-02-12" })] }),
      "PUT /api/plans/11/course": () => ({ body: plan({ id: 11, goal_id: 2 }) }),
    });
    renderWithApp(<CoursesPage />);
    const bruniquel = await screen.findByRole("article", { name: "Trail de Bruniquel" });
    await userEvent.selectOptions(within(bruniquel).getByLabelText("Attribuer un plan à Trail de Bruniquel"), "11");
    await waitFor(() => { expect(api.callsTo("PUT /api/plans/11/course")).toHaveLength(1); });
  });

  it("supprime un plan après confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = mockApi({
      "GET /api/goals": () => ({ body: GOALS }),
      "GET /api/plans": () => ({ body: [plan({})] }),
      "DELETE /api/plans/10": () => ({ body: { removed: 8, kept: 1 } }),
    });
    renderWithApp(<CoursesPage />);
    const rocs = await screen.findByRole("article", { name: "Trail des 3 Rocs" });
    await userEvent.click(within(rocs).getAllByRole("button", { name: "Supprimer" })[1] as HTMLElement);
    await waitFor(() => { expect(api.callsTo("DELETE /api/plans/10")).toHaveLength(1); });
    expect(await screen.findByText(/1 séance\(s\) réalisée\(s\) conservée\(s\)/)).toBeInTheDocument();
  });

  it("ne supprime rien si la confirmation est refusée", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const api = mockApi({
      "GET /api/goals": () => ({ body: GOALS }),
      "GET /api/plans": () => ({ body: [plan({})] }),
    });
    renderWithApp(<CoursesPage />);
    const rocs = await screen.findByRole("article", { name: "Trail des 3 Rocs" });
    await userEvent.click(within(rocs).getAllByRole("button", { name: "Supprimer" })[1] as HTMLElement);
    expect(api.callsTo("DELETE /api/plans/10")).toHaveLength(0);
  });

  it("ajoute puis modifie une course", async () => {
    const api = mockApi({
      "GET /api/goals": () => ({ body: [goal({})] }),
      "GET /api/plans": () => ({ body: [] }),
      "POST /api/goals": () => ({ status: 201, body: goal({ id: 3 }) }),
      "PUT /api/goals/1": () => ({ body: goal({}) }),
    });
    renderWithApp(<CoursesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "+ Ajouter une course" }));
    const form = screen.getByRole("form", { name: "Nouvelle course" });
    expect(within(form).getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText("Nom"), "Ultra");
    await userEvent.type(within(form).getByLabelText("Date"), "2027-06-05");
    await userEvent.type(within(form).getByLabelText("Distance (km)"), "80");
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => { expect(api.callsTo("POST /api/goals")[0]?.body).toEqual({ nom: "Ultra", date: "2027-06-05", distance_km: 80, dplus_m: null }); });

    const rocs = await screen.findByRole("article", { name: "Trail des 3 Rocs" });
    await userEvent.click(within(rocs).getByRole("button", { name: "Modifier" }));
    const edit = within(rocs).getByRole("form", { name: "Modifier la course" });
    await userEvent.clear(within(edit).getByLabelText("D+ (m)"));
    await userEvent.type(within(edit).getByLabelText("D+ (m)"), "1700");
    await userEvent.click(within(edit).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => { expect(api.callsTo("PUT /api/goals/1")[0]?.body).toMatchObject({ nom: "Trail des 3 Rocs", dplus_m: 1700, priorite: 1 }); });
  });

  it("sépare les courses passées et propose d'en ajouter quand il n'y en a aucune", async () => {
    mockApi({
      "GET /api/goals": () => ({ body: [goal({ id: 5, nom: "Ancienne", date: "2026-09-01" })] }),
      "GET /api/plans": () => ({ body: [] }),
    });
    renderWithApp(<CoursesPage />);
    expect(await screen.findByText("Courses passées")).toBeInTheDocument();
    expect(screen.getByText(/il y a 56 j/)).toBeInTheDocument();
  });
});
