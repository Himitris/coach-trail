import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
});

const open = async () => {
  await screen.findByRole("heading", { name: "Accueil" }); // la redirection vers la page d'accueil est faite
  await userEvent.click(screen.getByRole("button", { name: /Menu/ }));
};

const mount = (path = "/") => {
  mockApi({
    "GET /api/layout": () => ({ body: { revision: 0, layout: null, updated_at: null } }),
    "PUT /api/layout": () => ({ body: { revision: 1, layout: null, updated_at: null } }),
    "GET /api/sources/health": () => ({ body: [{ source: "garmin", state: "down", badge: "Garmin indisponible", message: null }] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <DashboardProvider>
            <Shell />
          </DashboardProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

describe("Menu de navigation", () => {
  it("regroupe pages et outils, sans Calendrier, et signale une source en panne", async () => {
    mount();
    await open();
    const menu = await screen.findByRole("dialog", { name: "Menu de navigation" });
    for (const name of [/Courses/, /Importer/, /Documentation/, /Sources/]) {
      expect(within(menu).getByRole("link", { name })).toBeInTheDocument();
    }
    expect(within(menu).queryByRole("link", { name: /Calendrier/ })).toBeNull();
    expect(within(menu).getAllByLabelText("Attention requise").length).toBeGreaterThan(0);
  });

  it("se ferme avec Échap et après avoir choisi un écran", async () => {
    mount();
    await open();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "Menu de navigation" })).toBeNull(); });

    await userEvent.click(screen.getByRole("button", { name: /Menu/ }));
    await userEvent.click(within(await screen.findByRole("dialog", { name: "Menu de navigation" })).getByRole("link", { name: /Courses/ }));
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "Menu de navigation" })).toBeNull(); });
  });

  it("l'ancienne adresse du calendrier renvoie à l'accueil", async () => {
    mount("/calendrier");
    expect(await screen.findByRole("button", { name: /Menu/ })).toBeInTheDocument();
    expect(screen.queryByText("Calendrier")).toBeNull();
  });
});
