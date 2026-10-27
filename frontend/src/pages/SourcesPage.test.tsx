import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceHealth } from "../api/endpoints";
import { ToastProvider } from "../app/toasts";
import { mockApi } from "../test/mockApi";
import { navigateExternal } from "../app/navigation";
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

const backup = {
  backup_dir: "/backup",
  last_run_at: "2026-10-15T02:30:00",
  ok: true,
  message: "Sauvegarde réussie en 0.2 s.",
  file: "coach-2026-10-15.db",
  size_bytes: 2_621_440,
  integrity: "ok",
  daily: 7,
  weekly: 4,
  monthly: 2,
  total_size_bytes: 31_457_280,
  stale: false,
  warning: null,
};

const status = { running: false, nightly_time: "03:30", next_run_at: null, last_run: null };

vi.mock("../app/navigation", () => ({ navigateExternal: vi.fn() }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(navigateExternal).mockClear();
  window.history.replaceState(null, "", "/");
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

  it("« Vérifier les nouveautés » annonce le nombre d'activités récupérées", async () => {
    let checked = false;
    const api = mockApi({
      "GET /api/sources/health": () => ({ body: [source({})] }),
      "GET /api/sync/status": () => ({
        body: {
          ...status,
          last_run: checked
            ? { trigger: "check", started_at: "2026-10-27T08:00:00", results: [{ source: "garmin", ok: true, inserted: 2 }] }
            : null,
        },
      }),
      "POST /api/sync/check": () => {
        checked = true;
        return { status: 202, body: { started: true } };
      },
    });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Vérifier les nouveautés" }));
    expect(await screen.findByText("2 nouvelle(s) activité(s).", undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(api.callsTo("POST /api/sync/check")).toHaveLength(1);
    expect(api.callsTo("POST /api/sync/run")).toHaveLength(0);
  });

  it("« Vérifier les nouveautés » dit « Rien de nouveau » et signale le 409", async () => {
    let busy = false;
    mockApi({
      "GET /api/sources/health": () => ({ body: [source({})] }),
      "GET /api/sync/status": () => ({
        body: { ...status, last_run: { trigger: "check", started_at: busy ? "2026-10-27T09:00:00" : "2026-10-27T08:00:00", results: [{ source: "garmin", ok: true, inserted: 0 }] } },
      }),
      "POST /api/sync/check": () => {
        if (busy) return { status: 409, body: { detail: "Une synchronisation est déjà en cours" } };
        busy = true;
        return { status: 202, body: { started: true } };
      },
    });
    mount();
    await userEvent.click(await screen.findByRole("button", { name: "Vérifier les nouveautés" }));
    expect(await screen.findByText("Rien de nouveau.", undefined, { timeout: 3000 })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Vérifier les nouveautés" }));
    expect(await screen.findByText("Une synchronisation est déjà en cours.")).toBeInTheDocument();
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

  it("affiche le statut de la dernière sauvegarde : date, taille, contrôle d'intégrité, rotation", async () => {
    mockApi({
      "GET /api/sources/health": () => ({ body: [source({})] }),
      "GET /api/sync/status": () => ({ body: status }),
      "GET /api/backup/status": () => ({ body: backup }),
    });
    mount();
    const card = within(await screen.findByLabelText("Sauvegardes"));
    expect(await card.findByText("Réussie")).toBeInTheDocument();
    expect(card.getByText("2,5 Mo")).toBeInTheDocument();
    expect(card.getByText("réussi")).toBeInTheDocument();
    expect(card.getByText(/7 quotidiennes · 4 hebdomadaires · 2 mensuelles/)).toBeInTheDocument();
  });

  it("signale une sauvegarde en échec, ancienne ou sur le même disque", async () => {
    mockApi({
      "GET /api/sources/health": () => ({ body: [source({})] }),
      "GET /api/sync/status": () => ({ body: status }),
      "GET /api/backup/status": () => ({
        body: {
          ...backup,
          ok: false,
          stale: true,
          integrity: null,
          size_bytes: null,
          message: "Échec : BackupError: base introuvable",
          warning: "La sauvegarde est sur le même volume que la base.",
        },
      }),
    });
    mount();
    const card = within(await screen.findByLabelText("Sauvegardes"));
    expect(await card.findByText("Échec")).toBeInTheDocument();
    expect(card.getByText(/base introuvable/)).toBeInTheDocument();
    expect(card.getByText(/même volume/)).toBeInTheDocument();
  });

  it("indique qu'aucune sauvegarde n'a encore eu lieu", async () => {
    mockApi({
      "GET /api/sources/health": () => ({ body: [source({})] }),
      "GET /api/sync/status": () => ({ body: status }),
      "GET /api/backup/status": () => ({
        body: { ...backup, ok: null, last_run_at: null, message: "Aucune sauvegarde effectuée.", daily: 0, weekly: 0, monthly: 0, total_size_bytes: 0, stale: true, file: null, size_bytes: null, integrity: null },
      }),
    });
    mount();
    const card = within(await screen.findByLabelText("Sauvegardes"));
    expect(await card.findByText("Aucune sauvegarde")).toBeInTheDocument();
  });

  const strava = (over: Record<string, unknown> = {}) => ({
    enabled: false,
    requested: false,
    configured: false,
    connected: false,
    scope: "read,activity:read_all",
    redirect_uri: "https://coach.himitris.fr/api/strava/callback",
    warning: "Avant d'activer Strava, lisez les conditions de l'API Strava du 1er juin 2026 : elles interdisent l'entraînement d'IA avec les données Strava.",
    limits: "Quotas par défaut : 200 requêtes / 15 min et 2 000 / jour.",
    ...over,
  });
  const baseRoutes = () => ({
    "GET /api/sources/health": () => ({ body: [source({})] }),
    "GET /api/sync/status": () => ({ body: status }),
    "GET /api/backup/status": () => ({ body: backup }),
  });

  it("Strava désactivé : avertissement sur les conditions de l'API et marche à suivre, aucun bouton", async () => {
    mockApi({ ...baseRoutes(), "GET /api/strava/status": () => ({ body: strava() }) });
    mount();
    const card = within(await screen.findByLabelText("Strava"));
    expect(await card.findByText("Désactivé")).toBeInTheDocument();
    expect(card.getByRole("note")).toHaveTextContent(/1er juin 2026.*entraînement d'IA/);
    expect(card.getByText(/STRAVA_ENABLED=true/)).toBeInTheDocument();
    expect(card.getByText("https://coach.himitris.fr/api/strava/callback")).toBeInTheDocument();
    expect(card.queryByRole("button")).toBeNull();
    expect(card.getByText(/Garmin prévaut/)).toBeInTheDocument();
  });

  it("Strava activé : « Connecter Strava » envoie vers l'autorisation de Strava", async () => {
    const api = mockApi({
      ...baseRoutes(),
      "GET /api/strava/status": () => ({ body: strava({ enabled: true, requested: true, configured: true }) }),
      "POST /api/strava/authorize": () => ({ body: { url: "https://www.strava.com/oauth/authorize?client_id=1&state=abc" } }),
    });
    mount();
    const card = within(await screen.findByLabelText("Strava"));
    expect(await card.findByText("À connecter")).toBeInTheDocument();
    await userEvent.click(card.getByRole("button", { name: "Connecter Strava" }));
    await waitFor(() => { expect(navigateExternal).toHaveBeenCalledWith("https://www.strava.com/oauth/authorize?client_id=1&state=abc"); });
    expect(api.callsTo("POST /api/strava/authorize")).toHaveLength(1);
  });

  it("Strava demandé sans identifiants : dit ce qui manque", async () => {
    mockApi({ ...baseRoutes(), "GET /api/strava/status": () => ({ body: strava({ requested: true }) }) });
    mount();
    const card = within(await screen.findByLabelText("Strava"));
    expect(await card.findByText(/STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET sont requis/)).toBeInTheDocument();
  });

  it("Strava connecté : déconnexion après confirmation", async () => {
    let connected = true;
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = mockApi({
      ...baseRoutes(),
      "GET /api/strava/status": () => ({ body: strava({ enabled: true, requested: true, configured: true, connected }) }),
      "POST /api/strava/disconnect": () => {
        connected = false;
        return { status: 204 };
      },
    });
    mount();
    const card = within(await screen.findByLabelText("Strava"));
    expect(await card.findByText("Connecté")).toBeInTheDocument();
    await userEvent.click(card.getByRole("button", { name: "Déconnecter Strava" }));
    await waitFor(() => { expect(api.callsTo("POST /api/strava/disconnect")).toHaveLength(1); });
    expect(await card.findByText("À connecter")).toBeInTheDocument();
    expect(await screen.findByText("Strava déconnecté.")).toBeInTheDocument();
  });

  it("retour de Strava : message selon le résultat, adresse nettoyée", async () => {
    window.history.replaceState(null, "", "/sources?strava=refuse");
    mockApi({ ...baseRoutes(), "GET /api/strava/status": () => ({ body: strava() }) });
    mount();
    expect(await screen.findByText("Connexion Strava refusée ou expirée.")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });
});
