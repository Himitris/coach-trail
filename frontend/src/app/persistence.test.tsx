import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardLayout } from "../layout/model";
import { mockApi } from "../test/mockApi";
import "../widgets";
import { DashboardProvider, SAVE_DELAY_MS, useDashboard } from "./DashboardProvider";
import { ToastProvider } from "./toasts";

function Probe() {
  const { layout, dispatch, saveStatus } = useDashboard();
  return (
    <div>
      <output aria-label="pages">{layout.pages.map((p) => p.title).join("|")}</output>
      <output aria-label="statut">{saveStatus}</output>
      <button onClick={() => { dispatch({ type: "addPage", id: "nouvelle", title: "Trail" }); }}>ajouter</button>
      <button
        onClick={() => {
          dispatch({ type: "renamePage", id: "nouvelle", title: "Trail renommé" });
        }}
      >
        renommer
      </button>
    </div>
  );
}

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <DashboardProvider>
          <Probe />
        </DashboardProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
};

const stored: DashboardLayout = {
  pages: [{ id: "home", title: "Accueil", widgets: [], layouts: { lg: [], md: [], sm: [] } }],
  home_page_id: "home",
};

describe("persistance côté serveur", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("charge la disposition du serveur sans la renvoyer", async () => {
    const api = mockApi({ "GET /api/layout": () => ({ body: { revision: 4, layout: stored, updated_at: null } }) });
    mount();
    expect(await screen.findByLabelText("pages")).toHaveTextContent("Accueil");
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS * 3));
    expect(api.callsTo("PUT /api/layout")).toHaveLength(0);
  });

  it("sans disposition enregistrée, la page d'accueil par défaut est créée sur le serveur", async () => {
    const api = mockApi({
      "GET /api/layout": () => ({ body: { revision: 0, layout: null, updated_at: null } }),
      "PUT /api/layout": ({ body }) => ({
        body: { revision: 1, layout: (body as { layout: DashboardLayout }).layout, updated_at: null },
      }),
    });
    mount();
    expect(await screen.findByLabelText("pages")).toHaveTextContent("Accueil");
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 50));
    const [put] = api.callsTo("PUT /api/layout");
    expect(put?.body).toMatchObject({ base_revision: 0, layout: { pages: [{ title: "Accueil" }] } });
  });

  it("regroupe les modifications (anti-rebond) et chaîne les révisions", async () => {
    const api = mockApi({
      "GET /api/layout": () => ({ body: { revision: 4, layout: stored, updated_at: null } }),
      "PUT /api/layout": ({ body }) => {
        const sent = body as { base_revision: number; layout: DashboardLayout };
        return { body: { revision: sent.base_revision + 1, layout: sent.layout, updated_at: null } };
      },
    });
    mount();
    await screen.findByLabelText("pages");
    fireEvent.click(screen.getByText("ajouter"));
    await act(() => vi.advanceTimersByTimeAsync(300));
    fireEvent.click(screen.getByText("renommer"));
    expect(screen.getByLabelText("statut")).toHaveTextContent("dirty");
    expect(api.callsTo("PUT /api/layout")).toHaveLength(0);

    await act(() => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 50));
    await waitFor(() => { expect(screen.getByLabelText("statut")).toHaveTextContent("saved"); });
    const puts = api.callsTo("PUT /api/layout");
    expect(puts).toHaveLength(1);
    expect(puts[0]?.body).toMatchObject({
      base_revision: 4,
      layout: { pages: [{ title: "Accueil" }, { id: "nouvelle", title: "Trail renommé" }] },
    });

    fireEvent.click(screen.getByText("ajouter")); // sans effet : la page existe déjà
    fireEvent.click(screen.getByText("renommer"));
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 50));
    expect(api.callsTo("PUT /api/layout")).toHaveLength(1); // aucun changement : rien à envoyer
  });

  it("un rechargement retrouve la disposition enregistrée", async () => {
    let server: { revision: number; layout: DashboardLayout | null } = { revision: 4, layout: stored };
    mockApi({
      "GET /api/layout": () => ({ body: { ...server, updated_at: null } }),
      "PUT /api/layout": ({ body }) => {
        const sent = body as { base_revision: number; layout: DashboardLayout };
        server = { revision: sent.base_revision + 1, layout: sent.layout };
        return { body: { ...server, updated_at: null } };
      },
    });
    const first = mount();
    await screen.findByLabelText("pages");
    fireEvent.click(screen.getByText("ajouter"));
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 50));
    await waitFor(() => { expect(screen.getByLabelText("statut")).toHaveTextContent("saved"); });
    first.unmount();

    mount(); // « rechargement »
    expect(await screen.findByLabelText("pages")).toHaveTextContent("Accueil|Trail");
  });

  it("une modification faite ailleurs (409) remplace la version locale et prévient", async () => {
    const elsewhere: DashboardLayout = {
      pages: [{ id: "home", title: "Modifié ailleurs", widgets: [], layouts: { lg: [], md: [], sm: [] } }],
      home_page_id: "home",
    };
    mockApi({
      "GET /api/layout": () => ({ body: { revision: 4, layout: stored, updated_at: null } }),
      "PUT /api/layout": () => ({
        status: 409,
        body: {
          detail: {
            message: "La disposition a été modifiée depuis un autre appareil.",
            current: { revision: 7, layout: elsewhere, updated_at: null },
          },
        },
      }),
    });
    mount();
    await screen.findByLabelText("pages");
    fireEvent.click(screen.getByText("ajouter"));
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS + 50));
    await waitFor(() => { expect(screen.getByLabelText("pages")).toHaveTextContent("Modifié ailleurs"); });
    expect(screen.getByLabelText("pages")).not.toHaveTextContent("Trail");
    expect(screen.getByText(/modifiée depuis un autre appareil/)).toBeInTheDocument();
  });

  it("affiche une erreur claire si le serveur est injoignable au chargement", async () => {
    mockApi({ "GET /api/layout": () => ({ status: 500, body: { detail: "Base indisponible" } }) });
    mount();
    await act(() => vi.advanceTimersByTimeAsync(1500)); // le chargement est réessayé une fois
    expect(await screen.findByRole("alert")).toHaveTextContent("Base indisponible");
  });
});
