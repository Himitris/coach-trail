import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../app/toasts";
import { mockApi } from "../test/mockApi";
import { GLOBAL_EXAMPLE } from "./engine";
import { ImportPage } from "./ImportPanel";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const mount = () =>
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <ImportPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

const paste = async (text: string) => {
  const box = screen.getByRole("textbox", { name: /collez la réponse/ });
  await userEvent.click(box);
  await userEvent.paste(text);
};

const line = (titre: string) => ({ titre, type: "footing", type_label: "Footing", objectif: null, duree_min: 50, zone_cible: null, dplus_cible: null, consignes: null });

const planReport = (over: Record<string, unknown> = {}, days: unknown[] = [{ date: "2026-11-03", action: "create", reason: null, existing: [], incoming: [line("Footing")] }]) => ({
  dry_run: true,
  applied: false,
  plan: { nom: "Fin de prépa 3 Rocs", action: "create", plan_id: null, course_id: 1, course_nom: "Trail des 3 Rocs", course_asked: "Trail des 3 Rocs", date_debut: "2026-11-03", date_fin: "2026-11-08" },
  warnings: [],
  summary: { sessions_in_file: 3, days_in_file: 3, created_days: 3, replaced_days: 0, unchanged_days: 0, blocked_days: 0, overlap_days: 0, sessions_added: 3, sessions_removed: 0 },
  days,
  ...over,
});

const goal = { id: 1, nom: "Trail des 3 Rocs", date: "2026-11-08", distance_km: 31, dplus_m: 1600, priorite: 1 };

/** Faux serveur pour l'exemple complet : rien n'existe encore. */
const fullApi = () =>
  mockApi({
    "POST /api/plan/import": (call) => ({ body: planReport({ dry_run: call.query.dry_run === "true", applied: call.query.dry_run !== "true" }) }),
    "GET /api/goals": () => ({ body: [goal] }),
    "POST /api/goals": () => ({ status: 201, body: { ...goal, id: 2 } }),
    "PUT /api/entries/2026-10-25": () => ({ body: {} }),
    "GET /api/gear": () => ({ body: { items: [], unassigned: [], unassigned_total: 0, evidence: { level: "indicatif", summary: "x" } } }),
    "POST /api/gear": () => ({ status: 201, body: { id: 1 } }),
  });

describe("Page Importer", () => {
  it("propose le prompt unique, la phrase pour le coach et l'exemple complet", () => {
    mockApi({});
    mount();
    expect(screen.getByRole("heading", { name: "Importer", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Prompt unique à donner à Claude")).toBeInTheDocument();
    expect(screen.getByText("Phrase pour mon coach")).toBeInTheDocument();
    expect(screen.getByText("Exemple valide")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmer l'import" })).toBeNull();
  });

  it("un document à quatre sections : un aperçu par section, une seule confirmation", async () => {
    const api = fullApi();
    mount();
    await paste(GLOBAL_EXAMPLE);

    const plan = await screen.findByRole("region", { name: "Séances prévues" });
    expect(within(plan).getByText(/Nouveau plan : « Fin de prépa 3 Rocs »/)).toBeInTheDocument();
    expect(within(plan).getByText(/course : Trail des 3 Rocs/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Courses" })).getByText(/sera créée/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Saisies du soir" })).getByText(/courbatures 6\/10/)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Paires de chaussures" })).getByText(/sera créée/)).toBeInTheDocument();
    expect(api.callsTo("POST /api/plan/import")[0]?.body).toMatchObject({ version: 2, plan: { nom: "Fin de prépa 3 Rocs" } });
    expect(api.callsTo("PUT /api/entries/2026-10-25")).toHaveLength(0); // aperçu : rien n'est écrit

    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'import" }));
    expect((await screen.findAllByText(/Plan importé : 3 séance\(s\) ajoutée\(s\)\. 1 saisie\(s\) importée\(s\)\. 1 course\(s\) créée\(s\)\. 1 paire\(s\) créée\(s\)\./)).length).toBeGreaterThan(0);
    await waitFor(() => { expect(api.callsTo("PUT /api/entries/2026-10-25")).toHaveLength(1); });
    expect(api.callsTo("POST /api/plan/import").at(-1)?.query.dry_run).toBe("false");
    expect(api.callsTo("POST /api/gear")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Confirmer l'import" })).toBeNull();
  });

  it("décocher une section l'exclut de l'import", async () => {
    const api = fullApi();
    mount();
    await paste(GLOBAL_EXAMPLE);
    await screen.findByRole("region", { name: "Saisies du soir" });
    await userEvent.click(screen.getByRole("checkbox", { name: "Importer : Paires de chaussures" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Importer : Saisies du soir" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'import" }));
    await waitFor(() => { expect(api.callsTo("POST /api/plan/import").at(-1)?.query.dry_run).toBe("false"); });
    expect(api.callsTo("POST /api/gear")).toHaveLength(0);
    expect(api.callsTo("PUT /api/entries/2026-10-25")).toHaveLength(0);
  });

  it("une section en erreur bloque la confirmation tant qu'elle est cochée ; les autres restent importables", async () => {
    const api = fullApi();
    mount();
    const doc = JSON.parse(GLOBAL_EXAMPLE) as Record<string, unknown>;
    doc.saisies = [{ date: "hier", courbatures: 12 }];
    await paste(JSON.stringify(doc));
    const entries = await screen.findByRole("region", { name: "Saisies du soir" });
    expect(within(entries).getByRole("alert")).toHaveTextContent(/2 erreurs/);
    expect(within(entries).getByRole("alert")).toHaveTextContent(/« courbatures » doit être un entier entre 0 et 10/);
    await waitFor(() => { expect(screen.getByRole("button", { name: "Confirmer l'import" })).toBeDisabled(); });

    await userEvent.click(screen.getByRole("checkbox", { name: "Importer : Saisies du soir" }));
    await waitFor(() => { expect(screen.getByRole("button", { name: "Confirmer l'import" })).toBeEnabled(); });
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'import" }));
    await waitFor(() => { expect(api.callsTo("POST /api/gear")).toHaveLength(1); });
    expect(api.callsTo("PUT /api/entries/2026-10-25")).toHaveLength(0);
  });

  it("clé inconnue, version inconnue, JSON invalide, note : erreurs en français, rien d'envoyé", async () => {
    const api = mockApi({});
    mount();
    await paste('{"version":2,"truc":1}');
    expect(await screen.findByRole("alert")).toHaveTextContent(/Champ inconnu « truc »/);
    fireEvent.change(screen.getByRole("textbox", { name: /collez la réponse/ }), { target: { value: '{"version":9,"saisies":[]}' } });
    expect(await screen.findByText(/Version non prise en charge/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /collez la réponse/ }), { target: { value: '{"saisies":[],"note":"x"}' } });
    expect(await screen.findByText(/widget Note/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /collez la réponse/ }), { target: { value: "{ pas du json" } });
    expect(await screen.findByText(/JSON valide/)).toBeInTheDocument();
    expect(api.calls).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Confirmer l'import" })).toBeNull();
  });

  it("un plan : course non reconnue signalée, chevauchement confirmé explicitement", async () => {
    const api = mockApi({
      "POST /api/plan/import": ({ query }) => ({
        body: planReport(
          {
            dry_run: query.dry_run === "true",
            applied: query.dry_run !== "true",
            plan: { nom: "Prépa Bruniquel", action: "update", plan_id: 2, course_id: null, course_nom: null, course_asked: "Bruniquel 39", date_debut: "2026-11-10", date_fin: "2026-12-20" },
            warnings: ["Course « Bruniquel 39 » non reconnue : le plan ne sera lié à aucune course."],
            summary: { sessions_in_file: 2, days_in_file: 2, created_days: 1, replaced_days: 0, unchanged_days: 0, blocked_days: 0, overlap_days: 1, sessions_added: 1, sessions_removed: 0 },
          },
          [
            { date: "2026-11-03", action: "overlap", reason: "Ce jour appartient à un autre plan (Prépa 3 Rocs) : confirmation nécessaire.", existing: [line("Ancien")], incoming: [line("Nouveau")] },
            { date: "2026-11-10", action: "create", reason: null, existing: [], incoming: [line("Footing facile")] },
          ],
        ),
      }),
    });
    mount();
    await paste('{"version":2,"plan":{"nom":"Prépa Bruniquel","course":"Bruniquel 39"},"sessions":[{"date":"2026-11-03","type":"footing"}]}');
    expect(await screen.findByText(/Plan existant mis à jour : « Prépa Bruniquel »/)).toBeInTheDocument();
    expect(screen.getByText(/aucune course liée/)).toBeInTheDocument();
    expect(screen.getByText(/Course « Bruniquel 39 » non reconnue/)).toBeInTheDocument();
    expect(screen.getByText(/3 nov\. — Autre plan \(confirmation\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: /Je confirme la modification de 1 jour\(s\) protégé\(s\)/ }));
    await userEvent.click(screen.getByRole("button", { name: "Confirmer l'import" }));
    await waitFor(() => { expect(api.callsTo("POST /api/plan/import")).toHaveLength(2); });
    expect(api.callsTo("POST /api/plan/import")[1]?.query).toMatchObject({ dry_run: "false", confirm_past_done: "true", confirm_overlap: "true" });
  });

  it("sans confirmation, les jours protégés ne sont pas confirmés à l'envoi", async () => {
    const api = mockApi({
      "POST /api/plan/import": ({ query }) => ({
        body: planReport(
          { dry_run: query.dry_run === "true", summary: { sessions_in_file: 2, days_in_file: 2, created_days: 1, replaced_days: 0, unchanged_days: 0, blocked_days: 1, overlap_days: 0, sessions_added: 1, sessions_removed: 0 } },
          [
            { date: "2026-10-07", action: "blocked", reason: "x", existing: [line("A")], incoming: [line("B")] },
            { date: "2026-11-03", action: "create", reason: null, existing: [], incoming: [line("C")] },
          ],
        ),
      }),
    });
    mount();
    await paste("[]");
    await userEvent.click(await screen.findByRole("button", { name: "Confirmer l'import" }));
    await waitFor(() => { expect(api.callsTo("POST /api/plan/import")).toHaveLength(2); });
    expect(api.callsTo("POST /api/plan/import")[1]?.query).toMatchObject({ confirm_past_done: "false", confirm_overlap: "false" });
  });

  it("plan déjà à jour : rien à confirmer", async () => {
    mockApi({
      "POST /api/plan/import": () => ({
        body: planReport(
          { summary: { sessions_in_file: 1, days_in_file: 1, created_days: 0, replaced_days: 0, unchanged_days: 1, blocked_days: 0, overlap_days: 0, sessions_added: 0, sessions_removed: 0 } },
          [{ date: "2026-11-03", action: "unchanged", reason: null, existing: [line("A")], incoming: [line("A")] }],
        ),
      }),
    });
    mount();
    await paste('{"sessions":[{"date":"2026-11-03","type":"footing"}]}');
    expect(await screen.findByText(/Rien à changer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer l'import" })).toBeDisabled();
  });

  it("le dépôt d'un fichier fonctionne comme le collage", async () => {
    mockApi({
      "PUT /api/entries/2026-10-25": () => ({ body: {} }),
    });
    mount();
    const content = '{"version":1,"saisies":[{"date":"2026-10-25","courbatures":3}]}';
    const file = new File([content], "retours.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(content) });
    await userEvent.upload(screen.getByLabelText("Fichier à importer"), file);
    expect(await screen.findByText(/courbatures 3\/10/)).toBeInTheDocument();
    expect(screen.getByText("retours.json")).toBeInTheDocument();
  });
});
