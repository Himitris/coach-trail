import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../app/toasts";
import { mockApi } from "../test/mockApi";
import { ImportPanel } from "./ImportPanel";
import { getImportSpec } from "./specs";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const mount = (widgetId: string, extra: Partial<Parameters<typeof ImportPanel>[0]> = {}) => {
  const spec = getImportSpec(widgetId);
  if (!spec) throw new Error("spec manquante");
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ImportPanel spec={spec} widgetTitle="Test" onClose={() => undefined} {...extra} />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

const paste = async (text: string) => {
  const box = screen.getByRole("textbox", { name: /collez la réponse/ });
  await userEvent.click(box);
  await userEvent.paste(text);
};

const report = (over = {}) => ({
  dry_run: true,
  applied: false,
  plan: null,
  warnings: [] as string[],
  summary: {
    sessions_in_file: 1,
    days_in_file: 1,
    created_days: 1,
    replaced_days: 0,
    unchanged_days: 0,
    blocked_days: 0,
    overlap_days: 0,
    sessions_added: 1,
    sessions_removed: 0,
    ...over,
  },
  days: [
    {
      date: "2026-11-03",
      action: "create",
      existing: [],
      incoming: [
        { titre: "Footing", type: "footing", type_label: "Footing", objectif: null, duree_min: 50, zone_cible: null, dplus_cible: null, consignes: null },
      ],
    },
  ],
});

describe("Panneau d'import", () => {
  it("applique une semaine type à la semaine choisie, puis enregistre après confirmation", async () => {
    const api = mockApi({ "POST /api/plan/import": (call) => ({ body: report({ dry_run: call.query.dry_run === "true" }) }) });
    mount("week-plan");
    const week = screen.getByLabelText("Semaine à remplir");
    fireEvent.change(week, { target: { value: "2026-11-04" } }); // un mercredi : le lundi 2026-11-02 est retenu
    await paste('{"version":1,"semaine_type":[{"jour":"mardi","type":"footing","duree_min":50}]}');

    expect(await screen.findByText(/Création : Footing/)).toBeInTheDocument();
    const preview = api.callsTo("POST /api/plan/import")[0];
    expect(preview?.query.dry_run).toBe("true");
    expect(preview?.body).toEqual({ version: 1, sessions: [{ date: "2026-11-03", type: "footing", duree_min: 50 }] });

    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'import" }));
    expect((await screen.findAllByText("Plan importé : 1 séance(s) ajoutée(s).")).length).toBeGreaterThan(0);
    expect(api.callsTo("POST /api/plan/import").at(-1)?.query.dry_run).toBe("false");
  });

  it("refuse un JSON invalide sans rien envoyer", async () => {
    const api = mockApi({});
    mount("week-plan");
    await paste("{ pas du json");
    expect(await screen.findByRole("alert")).toHaveTextContent(/JSON valide/);
    expect(api.calls).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Confirmer l'import" })).toBeNull();
  });

  it("liste toutes les erreurs de saisie en français", async () => {
    mockApi({});
    mount("evening-entry");
    await paste('{"version":1,"saisies":[{"date":"hier","courbatures":12,"inconnu":1}]}');
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/3 erreurs/);
    expect(alert).toHaveTextContent(/champ inconnu « inconnu »/);
    expect(alert).toHaveTextContent(/« courbatures » doit être un entier entre 0 et 10/);
  });

  it("importe les saisies du soir une par une", async () => {
    const api = mockApi({ "PUT /api/entries/2026-10-24": () => ({ body: {} }) });
    mount("evening-entry");
    await paste('{"version":1,"saisies":[{"date":"2026-10-24","courbatures":2,"malade":false}]}');
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer l'import" }));
    expect((await screen.findAllByText("1 saisie(s) importée(s).")).length).toBeGreaterThan(0);
    expect(api.callsTo("PUT /api/entries/2026-10-24")[0]?.body).toEqual({ courbatures: 2, malade: false });
  });

  it("ignore une course déjà présente", async () => {
    const api = mockApi({
      "GET /api/goals": () => ({
        body: [{ id: 1, nom: "Trail des 3 Rocs", date: "2026-11-08", distance_km: 31, dplus_m: 1600, priorite: 1 }],
      }),
    });
    mount("race-goal");
    await paste('{"version":1,"objectifs":[{"nom":"trail des 3 rocs","date":"2026-11-08"}]}');
    expect(await screen.findByText(/déjà présente, ignorée/)).toBeInTheDocument();
    expect(screen.getByText(/Rien à changer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer l'import" })).toBeDisabled();
    expect(api.callsTo("POST /api/goals")).toHaveLength(0);
  });

  it("remplace la note par du texte brut", async () => {
    mockApi({});
    const updateSettings = vi.fn();
    mount("note", { updateSettings });
    await paste("# Consignes\n- zones 1-2");
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer l'import" }));
    await waitFor(() => {
      expect(updateSettings).toHaveBeenCalledWith({ text: "# Consignes\n- zones 1-2" });
    });
  });

  it("propose le prompt de format, la phrase pour le coach et un exemple", () => {
    mockApi({});
    mount("week-plan");
    expect(screen.getByText("Prompt à coller dans Claude")).toBeInTheDocument();
    expect(screen.getByText("Phrase pour mon coach")).toBeInTheDocument();
    expect(screen.getByText("Exemple valide")).toBeInTheDocument();
  });
});
