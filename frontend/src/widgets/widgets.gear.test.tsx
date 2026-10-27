import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GearItem, GearReport } from "../api/types";
import { evidence } from "../test/fixtures";
import { mockApi } from "../test/mockApi";
import { renderWithApp, widgetProps } from "../test/render";
import { getWidget } from ".";
import { GearWidget } from "./GearWidget";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const item = (over: Partial<GearItem> = {}): GearItem => ({
  id: 1,
  nom: "Speedcross 6",
  registered: true,
  seuil_km: 800,
  km_initial: 0,
  km_total: 412.4,
  km_activities: 412.4,
  activities: 38,
  last_used: "2026-10-24",
  usage_pct: 51.55,
  status: "ok",
  message: null,
  ...over,
});

const report = (over: Partial<GearReport> = {}): GearReport => ({
  items: [item(), item({ id: 2, nom: "Pegasus 40", km_total: 760, usage_pct: 95, status: "surveiller", message: "Environ 95 % du seuil de 800 km : à surveiller. Repère personnel, l'usure réelle varie.", activities: 70 }), item({ id: null, nom: "Vieilles", registered: false, km_total: 20, usage_pct: 2.5, activities: 2 })],
  unassigned: [{ activity_id: 9, day: "2026-10-23", sport: "running", distance_km: 11.2 }],
  unassigned_total: 1,
  evidence: evidence("indicatif", "Le seuil d'usure est un repère personnel."),
  ...over,
});

describe("Matériel", () => {
  it("kilométrage par paire, barre d'usure, alerte douce à l'approche du seuil", async () => {
    mockApi({ "GET /api/gear": () => ({ body: report() }) });
    renderWithApp(<GearWidget {...widgetProps({ showRetired: false })} />);
    const speed = await screen.findByLabelText("Paire Speedcross 6");
    expect(speed).toHaveTextContent("412,4 km");
    expect(speed).toHaveTextContent("sur 800 km");
    expect(within(speed).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "52");
    expect(within(speed).queryByRole("note")).toBeNull();
    const pegasus = screen.getByLabelText("Paire Pegasus 40");
    expect(within(pegasus).getByRole("note")).toHaveTextContent("à surveiller");
    expect(pegasus).toHaveTextContent("à surveiller");
    expect(screen.getByText(/Le seuil d'usure est un repère personnel/)).toBeInTheDocument();
  });

  it("une paire vue dans les sorties peut être enregistrée", async () => {
    const api = mockApi({
      "GET /api/gear": () => ({ body: report() }),
      "POST /api/gear": () => ({ status: 201, body: { id: 3 } }),
    });
    renderWithApp(<GearWidget {...widgetProps({ showRetired: false })} />);
    const old = await screen.findByLabelText("Paire Vieilles");
    await userEvent.click(within(old).getByRole("button", { name: /Enregistrer cette paire/ }));
    await waitFor(() => { expect(api.callsTo("POST /api/gear")).toHaveLength(1); });
    expect(api.callsTo("POST /api/gear")[0]?.body).toEqual({ nom: "Vieilles", seuil_km: 800, km_initial: 0 });
  });

  it("réglage du seuil d'usure et des km déjà parcourus", async () => {
    const api = mockApi({ "GET /api/gear": () => ({ body: report() }), "PUT /api/gear/1": () => ({ status: 204 }) });
    renderWithApp(<GearWidget {...widgetProps({ showRetired: false })} />);
    const row = await screen.findByLabelText("Paire Speedcross 6");
    await userEvent.click(within(row).getByRole("button", { name: "Réglages" }));
    const form = within(row).getByRole("form", { name: "Réglages de Speedcross 6" });
    await userEvent.clear(within(form).getByLabelText("Seuil d'usure (km)"));
    await userEvent.type(within(form).getByLabelText("Seuil d'usure (km)"), "600");
    await userEvent.clear(within(form).getByLabelText("Km déjà parcourus avant l'appli"));
    await userEvent.type(within(form).getByLabelText("Km déjà parcourus avant l'appli"), "120");
    await userEvent.click(within(form).getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => { expect(api.callsTo("PUT /api/gear/1")).toHaveLength(1); });
    expect(api.callsTo("PUT /api/gear/1")[0]?.body).toEqual({ seuil_km: 600, km_initial: 120 });
  });

  it("retirer une paire la masque, sauf si « afficher les paires retirées »", async () => {
    const retired = report({ items: [item({ status: "retire", nom: "Anciennes" }), item({ id: 5, nom: "Actives" })] });
    mockApi({ "GET /api/gear": () => ({ body: retired }) });
    const { unmount } = renderWithApp(<GearWidget {...widgetProps({ showRetired: false })} />);
    await screen.findByLabelText("Paire Actives");
    expect(screen.queryByLabelText("Paire Anciennes")).toBeNull();
    unmount();
    renderWithApp(<GearWidget {...widgetProps({ showRetired: true })} />);
    expect(await screen.findByLabelText("Paire Anciennes")).toBeInTheDocument();
  });

  it("ajout d'une paire par son nom", async () => {
    const api = mockApi({ "GET /api/gear": () => ({ body: report({ items: [] , unassigned: [], unassigned_total: 0 }) }), "POST /api/gear": () => ({ status: 201, body: { id: 4 } }) });
    renderWithApp(<GearWidget {...widgetProps({ showRetired: false })} />);
    expect(await screen.findByText(/Aucune paire détectée ou enregistrée/)).toBeInTheDocument();
    const form = screen.getByRole("form", { name: "Ajouter une paire" });
    expect(within(form).getByRole("button", { name: "Ajouter" })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText("Nouvelle paire"), "Peregrine 12");
    await userEvent.click(within(form).getByRole("button", { name: "Ajouter" }));
    await waitFor(() => { expect(api.callsTo("POST /api/gear")).toHaveLength(1); });
    expect(api.callsTo("POST /api/gear")[0]?.body).toEqual({ nom: "Peregrine 12", seuil_km: 800, km_initial: 0 });
  });

  it("affectation manuelle d'une sortie sans paire", async () => {
    const api = mockApi({ "GET /api/gear": () => ({ body: report() }), "PUT /api/gear/assign/activity": () => ({ status: 204 }) });
    renderWithApp(<GearWidget {...widgetProps({ showRetired: false })} />);
    await screen.findByText("Sorties sans paire (1)");
    const select = screen.getByLabelText(/Paire pour la sortie du 23 oct\./);
    expect(within(select).queryByRole("option", { name: "Vieilles" })).toBeNull(); // non enregistrée : pas affectable
    await userEvent.selectOptions(select, "2");
    await waitFor(() => { expect(api.callsTo("PUT /api/gear/assign/activity")).toHaveLength(1); });
    expect(api.callsTo("PUT /api/gear/assign/activity")[0]?.body).toEqual({ activity_id: 9, gear_id: 2 });
  });

  it("erreur du serveur : message sur la paire concernée ; erreur de chargement : message", async () => {
    mockApi({ "GET /api/gear": () => ({ body: report() }), "PUT /api/gear/1": () => ({ status: 409, body: { detail: "Une paire porte déjà ce nom." } }) });
    renderWithApp(<GearWidget {...widgetProps({ showRetired: false })} />);
    const row = await screen.findByLabelText("Paire Speedcross 6");
    await userEvent.click(within(row).getByRole("button", { name: "Retirer" }));
    expect(await within(row).findByText("Une paire porte déjà ce nom.")).toBeInTheDocument();
    vi.unstubAllGlobals();
    mockApi({ "GET /api/gear": () => ({ status: 500, body: { detail: "panne" } }) });
    renderWithApp(<GearWidget {...widgetProps({ showRetired: false })} />);
    expect(await screen.findByText("panne")).toBeInTheDocument();
  });

  it("export Markdown : km, seuil, alertes ; vide : message", async () => {
    mockApi({ "GET /api/gear": () => ({ body: report() }) });
    const block = await getWidget("gear")?.exportData({ showRetired: false });
    const md = (block?.markdown ?? "").replace(/\s/g, " ");
    expect(md).toContain("| Speedcross 6 | 412,4 km | 800 km | 52 % | 38 | 24 oct. | ok |");
    expect(md).toContain("Pegasus 40 : Environ 95 % du seuil");
    expect(md).toContain("1 sortie(s) de course à pied sans paire affectée.");
    vi.unstubAllGlobals();
    mockApi({ "GET /api/gear": () => ({ body: report({ items: [], unassigned_total: 0, unassigned: [] }) }) });
    expect((await getWidget("gear")?.exportData({ showRetired: false }))?.markdown).toContain("Aucune paire de chaussures");
  });
});
