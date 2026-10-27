import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceHealth } from "../api/endpoints";
import { ToastProvider } from "../app/toasts";
import { mockApi } from "../test/mockApi";
import { SourcesPage } from "./SourcesPage";

const source = (over: Partial<SourceHealth>): SourceHealth => ({
  source: "garmin",
  label: "Garmin",
  state: "ok",
  message: "Synchronisation à jour",
  last_success_at: "2026-10-14T03:31:00",
  last_error_at: null,
  last_error_message: null,
  unavailable_since: null,
  badge: null,
  ...over,
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <SourcesPage />
      </ToastProvider>
    </QueryClientProvider>,
  );

const status = { running: false, nightly_time: "03:30", next_run_at: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Santé des sources", () => {
  it("affiche l'état, le badge d'indisponibilité et les dates", async () => {
    mockApi({
      "GET /api/sources/health": () => ({
        body: [
          source({
            state: "down",
            message: "Garmin injoignable.",
            unavailable_since: "2026-10-12T04:00:00",
            badge: "Garmin indisponible depuis le 12/10/2026",
            last_error_at: "2026-10-14T03:30:00",
          }),
          source({ source: "intervals", label: "Intervals.icu", state: "jamais_synchronise", message: null }),
        ],
      }),
      "GET /api/sync/status": () => ({ body: status }),
    });
    mount();
    expect(await screen.findByText("Garmin indisponible depuis le 12/10/2026")).toBeInTheDocument();
    expect(screen.getByText("Indisponible")).toBeInTheDocument();
    expect(screen.getByText("Jamais synchronisée")).toBeInTheDocument();
    expect(screen.getByText("Garmin injoignable.")).toBeInTheDocument();
    expect(screen.getByText(/chaque nuit à 03:30/)).toBeInTheDocument();
  });

  it("« Synchroniser maintenant » lance la synchronisation puis relit l'état des sources", async () => {
    let synced = false;
    const api = mockApi({
      "GET /api/sources/health": () => ({
        body: [synced ? source({ state: "auth_required", message: "Reconnexion nécessaire." }) : source({})],
      }),
      "GET /api/sync/status": () => ({ body: status }),
      "POST /api/sync/run": () => {
        synced = true; // la synchronisation est déjà finie quand le suivi démarre
        return { status: 202, body: { started: true } };
      },
    });
    mount();
    expect(await screen.findByText("À jour")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Synchroniser maintenant" }));
    await waitFor(() => { expect(api.callsTo("POST /api/sync/run")).toHaveLength(1); });
    expect(await screen.findByText("Synchronisation lancée.")).toBeInTheDocument();
    expect(await screen.findByText("Reconnexion requise")).toBeInTheDocument();
  });

  it("indique qu'une synchronisation est déjà en cours (409) et suit son avancement", async () => {
    let running = false;
    const api = mockApi({
      "GET /api/sources/health": () => ({ body: [source({})] }),
      "GET /api/sync/status": () => ({ body: { ...status, running } }),
      "POST /api/sync/run": () => {
        running = true;
        return { status: 409, body: { detail: "Une synchronisation est déjà en cours" } };
      },
    });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Synchroniser maintenant" }));
    expect(await screen.findByText("Une synchronisation est déjà en cours.")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Synchronisation en cours…" })).toBeDisabled();
    expect(api.callsTo("GET /api/sync/status").length).toBeGreaterThan(1);
  });

  it("l'écran de reconnexion Garmin gère le MFA en deux étapes et efface le mot de passe", async () => {
    const api = mockApi({
      "GET /api/sources/health": () => ({
        body: [source({ state: "auth_required", message: "Reconnexion nécessaire.", badge: "Garmin indisponible depuis le 12/10/2026" })],
      }),
      "GET /api/sync/status": () => ({ body: status }),
      "POST /api/garmin/login": ({ body }) =>
        "password" in (body as object)
          ? { body: { status: "mfa_required", ticket: "ticket-1" } }
          : { body: { status: "ok", ticket: null } },
    });
    mount();
    const email = await screen.findByLabelText("E-mail Garmin");
    const password = screen.getByLabelText("Mot de passe");
    expect(password).toHaveAttribute("type", "password");
    await userEvent.type(email, "moi@example.org");
    await userEvent.type(password, "s3cret!");
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    const code = await screen.findByLabelText("Code MFA");
    expect(screen.queryByDisplayValue("s3cret!")).toBeNull(); // le mot de passe n'est plus en mémoire
    await userEvent.type(code, "123456");
    await userEvent.click(screen.getByRole("button", { name: "Valider le code" }));
    expect(await screen.findByText(/Connexion Garmin réussie/)).toBeInTheDocument();

    const logins = api.callsTo("POST /api/garmin/login");
    expect(logins.map((c) => c.body)).toEqual([
      { email: "moi@example.org", password: "s3cret!" },
      { ticket: "ticket-1", mfa_code: "123456" },
    ]);
  });

  it("affiche l'erreur de connexion sans réafficher le mot de passe", async () => {
    mockApi({
      "GET /api/sources/health": () => ({ body: [source({ state: "auth_required", message: "Reconnexion nécessaire." })] }),
      "GET /api/sync/status": () => ({ body: status }),
      "POST /api/garmin/login": () => ({ status: 401, body: { detail: "Identifiants Garmin refusés." } }),
    });
    mount();
    fireEvent.change(await screen.findByLabelText("E-mail Garmin"), { target: { value: "moi@example.org" } });
    fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "mauvais" } });
    await userEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByText("Identifiants Garmin refusés.")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toHaveValue("");
  });

  it("propose la reconnexion même quand la source n'est pas en erreur", async () => {
    mockApi({
      "GET /api/sources/health": () => ({ body: [source({})] }),
      "GET /api/sync/status": () => ({ body: status }),
    });
    mount();
    expect(screen.queryByLabelText("E-mail Garmin")).toBeNull();
    await userEvent.click(await screen.findByRole("button", { name: "Se reconnecter à Garmin" }));
    expect(screen.getByLabelText("E-mail Garmin")).toBeInTheDocument();
  });
});
