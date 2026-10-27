import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportedActivity } from "../api/endpoints";
import { ToastProvider } from "../app/toasts";
import { mockApi } from "../test/mockApi";
import { SourcesPage } from "./SourcesPage";

vi.mock("../app/navigation", () => ({ navigateExternal: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); });

const imported = (over: Partial<ImportedActivity> = {}): ImportedActivity => ({
  activity_id: 7,
  created: true,
  sport: "trail_running",
  start_utc: "2026-10-25T05:00:00",
  duration_min: 62.4,
  distance_km: 11.04,
  dplus_m: 420,
  hr_avg: 148,
  has_stream: true,
  same_session_as: [],
  warnings: [],
  ...over,
});

const base = {
  "GET /api/sources/health": () => ({ body: [] }),
  "GET /api/sync/status": () => ({ body: { running: false, nightly_time: "03:30", next_run_at: null } }),
  "GET /api/strava/status": () => ({ status: 404, body: { detail: "x" } }),
  "GET /api/backup/status": () => ({ status: 404, body: { detail: "x" } }),
};

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <SourcesPage />
      </ToastProvider>
    </QueryClientProvider>,
  );

describe("Import FIT / GPX", () => {
  it("envoie les octets bruts avec le nom et le sport, puis affiche le résultat et la déduplication", async () => {
    const api = mockApi({
      ...base,
      "POST /api/import/activity": () => ({
        status: 201,
        body: imported({ same_session_as: ["garmin"], warnings: ["Pauses exclues (2)."] }),
      }),
    });
    mount();
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: /Sport/ }), "trail_running");
    const file = new File([new Uint8Array([1, 2, 3])], "sortie du matin.gpx");
    await userEvent.upload(screen.getByLabelText("Fichier à importer"), file);

    expect(await screen.findByText("Séance importée.")).toBeInTheDocument();
    const call = api.callsTo("POST /api/import/activity")[0];
    expect(call?.query).toEqual({ filename: "sortie du matin.gpx", sport: "trail_running" });
    const init = api.fetchMock.mock.calls.find(([url]) => typeof url === "string" && url.startsWith("/api/import/activity"))?.[1];
    expect(init?.body).toBe(file);
    expect(new Headers(init?.headers).get("Content-Type")).toBe("application/octet-stream");

    expect(screen.getByText(/Importée : trail running, 62 min, 11,0 km, D\+ 420 m, FC moy\. 148/)).toBeInTheDocument();
    expect(screen.getByText(/Même séance que celle déjà reçue de : garmin/)).toBeInTheDocument();
    expect(screen.getByText("Pauses exclues (2).")).toBeInTheDocument();
  });

  it("sans sport choisi, n'envoie pas de paramètre sport ; un fichier déjà importé est signalé", async () => {
    const api = mockApi({
      ...base,
      "POST /api/import/activity": () => ({ status: 201, body: imported({ created: false, has_stream: false }) }),
    });
    mount();
    await userEvent.upload(await screen.findByLabelText("Fichier à importer"), new File(["x"], "a.fit"));
    expect(await screen.findByText("Ce fichier était déjà importé : rien n'a changé.")).toBeInTheDocument();
    expect(api.callsTo("POST /api/import/activity")[0]?.query).toEqual({ filename: "a.fit" });
    expect(screen.getByText(/Pas de flux seconde par seconde/)).toBeInTheDocument();
  });

  it("affiche l'erreur du serveur pour un fichier illisible", async () => {
    mockApi({
      ...base,
      "POST /api/import/activity": () => ({ status: 422, body: { detail: "Fichier FIT illisible." } }),
    });
    mount();
    await userEvent.upload(await screen.findByLabelText("Fichier à importer"), new File(["x"], "a.fit"));
    expect(await screen.findByText("Fichier FIT illisible.")).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole("status", { name: "" })).not.toHaveTextContent("Importée"); });
  });
});
