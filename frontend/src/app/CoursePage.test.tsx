import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../test/mockApi";
import "../widgets";
import { DashboardProvider } from "./DashboardProvider";
import { Shell } from "./Shell";
import { ToastProvider } from "./toasts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Page d'exemple « Course »", () => {
  it("le bouton crée la page avec objectif, nutrition, fatigue et monotonie", async () => {
    // jsdom ne mesure rien : la grille a besoin d'une largeur pour afficher ses cadres
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1200);
    mockApi({
      "GET /api/layout": () => ({ body: { revision: 0, layout: null, updated_at: null } }),
      "PUT /api/layout": () => ({ body: { revision: 1, layout: null, updated_at: null } }),
      "GET /api/sources/health": () => ({ body: [] }),
      "GET /api/goals": () => ({ body: [] }),
      "GET /api/metrics/race-goal": () => ({ status: 404, body: { detail: "Aucun" } }),
      "GET /api/fueling/series": () => ({ body: { min_hours: 2.5, points: [], missing: 0, evidence: { level: "indicatif", summary: "x" } } }),
      "GET /api/metrics/fatigue": () => ({ body: { weeks: [], strong_sessions: [], suggestion: null, evidence: { level: "indicatif", summary: "x" } } }),
      "GET /api/metrics/monotony": () => ({ body: { reference: 2, weeks: [], evidence: { level: "indicatif", summary: "x" } } }),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <DashboardProvider>
              <Shell />
            </DashboardProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "+ Course" }));
    expect(await screen.findByRole("heading", { name: "Course", level: 1 })).toBeInTheDocument();
    for (const title of ["Objectif de course", "Nutrition en course", "Fatigue musculaire", "Monotonie et tension"]) {
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    }
  });
});
