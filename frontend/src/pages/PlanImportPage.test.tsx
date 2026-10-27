import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlanImportReport } from "../api/endpoints";
import { mockApi } from "../test/mockApi";
import { renderWithApp } from "../test/render";
import { PlanImportPage } from "./PlanImportPage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const line = (titre: string, over: Record<string, unknown> = {}) => ({
  titre,
  type: "footing",
  type_label: "Footing",
  objectif: null,
  duree_min: 50,
  zone_cible: "1-2",
  dplus_cible: 80,
  consignes: null,
  ...over,
});

const report = (over: Partial<PlanImportReport> = {}): PlanImportReport => ({
  dry_run: true,
  applied: false,
  summary: { sessions_in_file: 3, days_in_file: 3, created_days: 1, replaced_days: 1, unchanged_days: 0, blocked_days: 1, sessions_added: 2, sessions_removed: 1 },
  days: [
    { date: "2026-10-07", action: "blocked", reason: "Jour passé avec une séance déjà réalisée : confirmation explicite nécessaire.", existing: [line("Ancien")], incoming: [line("Nouveau")] },
    { date: "2026-11-03", action: "create", reason: null, existing: [], incoming: [line("Footing facile")] },
    { date: "2026-11-05", action: "replace", reason: null, existing: [line("Seuil", { type: "seuil" })], incoming: [line("Côtes", { type: "cotes", zone_cible: "3-4" })] },
  ],
  ...over,
});

const file = (content: string, name = "plan.json") => {
  const f = new File([content], name, { type: "application/json" });
  Object.defineProperty(f, "text", { value: () => Promise.resolve(content) });
  return f;
};

describe("Import de plan", () => {
  it("dépôt du fichier : aperçu sans rien écrire, puis confirmation explicite des jours réalisés", async () => {
    const api = mockApi({
      "POST /api/plan/import": ({ query }) => ({
        body: query.dry_run === "true" ? report() : report({ dry_run: false, applied: true }),
      }),
    });
    renderWithApp(<PlanImportPage />);
    await userEvent.upload(screen.getByLabelText("Fichier du plan"), file('{"sessions":[{"date":"2026-11-03","type":"footing"}]}'));

    const table = await screen.findByRole("table");
    expect(api.callsTo("POST /api/plan/import")[0]?.query).toMatchObject({ dry_run: "true", confirm_past_done: "false" });
    expect(screen.getByText(/Aperçu \(rien n'est enregistré\)/)).toBeInTheDocument();
    expect(within(table).getByRole("row", { name: /3 nov\./ })).toHaveTextContent("Création");
    expect(within(table).getByRole("row", { name: /5 nov\./ })).toHaveTextContent("Seuil");
    expect(within(table).getByRole("row", { name: /5 nov\./ })).toHaveTextContent("Côtes, 50 min, Z3-4");
    expect(within(table).getByRole("row", { name: /7 oct\./ })).toHaveTextContent("Bloqué (jour réalisé)");

    await userEvent.click(screen.getByRole("checkbox", { name: /Je confirme la modification des jours passés/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'import" }));
    await waitFor(() => { expect(api.callsTo("POST /api/plan/import")).toHaveLength(2); });
    const second = api.callsTo("POST /api/plan/import")[1];
    expect(second?.query).toMatchObject({ dry_run: "false", confirm_past_done: "true" });
    expect(second?.body).toEqual({ sessions: [{ date: "2026-11-03", type: "footing" }] });
    expect(await screen.findByText(/Plan enregistré/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmer l'import" })).toBeNull();
  });

  it("sans confirmation, les jours réalisés ne sont pas confirmés à l'envoi", async () => {
    const api = mockApi({ "POST /api/plan/import": () => ({ body: report() }) });
    renderWithApp(<PlanImportPage />);
    await userEvent.upload(screen.getByLabelText("Fichier du plan"), file("[]"));
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer l'import" }));
    await waitFor(() => { expect(api.callsTo("POST /api/plan/import")).toHaveLength(2); });
    expect(api.callsTo("POST /api/plan/import")[1]?.query.confirm_past_done).toBe("false");
  });

  it("erreurs du serveur listées ligne par ligne, aucune confirmation possible", async () => {
    mockApi({
      "POST /api/plan/import": () => ({
        status: 422,
        body: {
          detail: {
            message: "Le plan contient 2 erreurs : rien n'a été enregistré.",
            errors: [
              { session: 2, field: "type", message: "« type » est obligatoire parmi : footing, cotes (reçu : 'fartlek')." },
              { session: null, field: "version", message: "Version de plan non prise en charge : 2 (attendu : 1)." },
            ],
          },
        },
      }),
    });
    renderWithApp(<PlanImportPage />);
    await userEvent.upload(screen.getByLabelText("Fichier du plan"), file('{"version":2}'));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Le plan contient 2 erreurs : rien n'a été enregistré.");
    expect(alert).toHaveTextContent("Séance 2 : « type » est obligatoire");
    expect(alert).toHaveTextContent("Fichier : Version de plan non prise en charge");
    expect(screen.queryByRole("button", { name: "Confirmer l'import" })).toBeNull();
  });

  it("un fichier qui n'est pas du JSON est refusé sans appeler le serveur", async () => {
    const api = mockApi({});
    renderWithApp(<PlanImportPage />);
    await userEvent.upload(screen.getByLabelText("Fichier du plan"), file("pas du json"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce fichier n'est pas un JSON valide.");
    expect(api.calls).toHaveLength(0);
  });

  it("plan déjà à jour : rien à confirmer", async () => {
    mockApi({
      "POST /api/plan/import": () => ({
        body: report({
          summary: { sessions_in_file: 1, days_in_file: 1, created_days: 0, replaced_days: 0, unchanged_days: 1, blocked_days: 0, sessions_added: 0, sessions_removed: 0 },
          days: [{ date: "2026-11-03", action: "unchanged", reason: null, existing: [line("A")], incoming: [line("A")] }],
        }),
      }),
    });
    renderWithApp(<PlanImportPage />);
    await userEvent.upload(screen.getByLabelText("Fichier du plan"), file("[]"));
    expect(await screen.findByText(/Rien à changer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer l'import" })).toBeDisabled();
  });
});
