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
  vi.restoreAllMocks();
});

const mount = () => {
  mockApi({
    "GET /api/layout": () => ({ body: { revision: 0, layout: null, updated_at: null } }),
    "PUT /api/layout": () => ({ body: { revision: 1, layout: null, updated_at: null } }),
    "GET /api/sources/health": () => ({ body: [] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <DashboardProvider>
            <Shell />
          </DashboardProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

describe("Menu ⋯ d'une page", () => {
  it("s'affiche hors de la barre d'onglets (non rogné) et supprime la page", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Nouvelle page" }));
    await userEvent.keyboard("{Enter}"); // valide le nom proposé
    await waitFor(() => { expect(screen.getAllByRole("tab")).toHaveLength(2); });

    await userEvent.click(await screen.findByRole("button", { name: /Actions de la page/ }));
    const menu = await screen.findByRole("menu");
    expect(menu.parentElement).toBe(document.body);
    expect(menu).toHaveClass("menu-floating"); // position: fixed en CSS
    expect(within(menu).getByRole("menuitem", { name: "Renommer" })).toBeInTheDocument();

    await userEvent.click(within(menu).getByRole("menuitem", { name: "Supprimer" }));
    await waitFor(() => { expect(screen.getAllByRole("tab")).toHaveLength(1); });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("se ferme avec Échap", async () => {
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Nouvelle page" }));
    await userEvent.keyboard("{Enter}");
    await userEvent.click(await screen.findByRole("button", { name: /Actions de la page/ }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => { expect(screen.queryByRole("menu")).not.toBeInTheDocument(); });
  });
});
