import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../test/mockApi";
import { renderWithApp } from "../test/render";
import { ActivityExportButton, ExportButton, WidgetExportMenu } from "./ExportButtons";

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 15, 12));
  writeText.mockReset().mockResolvedValue();
});

/** `userEvent.setup()` installe son propre presse-papiers : le nôtre se pose après. */
function setupUser() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return user;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Copier pour Claude", () => {
  it("copie l'export de la période choisie en deux clics et confirme", async () => {
    const api = mockApi({ "GET /api/export": () => ({ body: "# Coach Trail — export\n" }) });
    const user = setupUser();
    renderWithApp(<ExportButton />);

    await user.click(screen.getByRole("button", { name: "Copier pour Claude" }));
    const dialog = screen.getByRole("dialog", { name: "Copier pour Claude" });
    await user.click(within(dialog).getByRole("button", { name: "Copier" }));

    await waitFor(() => { expect(writeText).toHaveBeenCalledWith("# Coach Trail — export\n"); });
    expect(api.calls[0]?.query).toEqual({ from: "2026-09-18", to: "2026-10-15", format: "md" }); // 4 semaines par défaut
    expect(await screen.findByText(/Export copié pour Claude/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("applique la période choisie et propose les téléchargements JSON", async () => {
    const api = mockApi({ "GET /api/export": () => ({ body: "ok" }) });
    const user = setupUser();
    renderWithApp(<ExportButton />);
    await user.click(screen.getByRole("button", { name: "Copier pour Claude" }));
    await user.click(screen.getByLabelText("7 jours"));

    await user.click(screen.getByLabelText("JSON"));
    expect(screen.getByRole("link", { name: "Télécharger le JSON complet" })).toHaveAttribute(
      "href",
      "/api/export?from=2026-10-09&to=2026-10-15&format=json",
    );
    await user.click(screen.getByLabelText("Markdown"));
    expect(screen.getByRole("link", { name: "Flux de séances (JSON)" })).toHaveAttribute(
      "href",
      "/api/export/streams?from=2026-10-09&to=2026-10-15",
    );
    await user.click(screen.getByRole("button", { name: "Copier" }));
    await waitFor(() => { expect(api.calls[0]?.query.from).toBe("2026-10-09"); });
  });

  it("refuse une plage libre inversée", async () => {
    const api = mockApi({});
    const user = setupUser();
    renderWithApp(<ExportButton />);
    await user.click(screen.getByRole("button", { name: "Copier pour Claude" }));
    await user.click(screen.getByLabelText("Plage libre"));
    await user.clear(screen.getByLabelText("Au"));
    await user.type(screen.getByLabelText("Au"), "2026-01-01");

    expect(screen.getByText(/doit précéder/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copier" })).toBeDisabled();
    expect(api.calls).toHaveLength(0);
  });

  it("signale un échec du serveur sans rien copier", async () => {
    mockApi({ "GET /api/export": () => ({ status: 500, body: { detail: "boom" } }) });
    const user = setupUser();
    renderWithApp(<ExportButton />);
    await user.click(screen.getByRole("button", { name: "Copier pour Claude" }));
    await user.click(screen.getByRole("button", { name: "Copier" }));

    expect(await screen.findByText("L'export a échoué.")).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("Export d'une séance", () => {
  it("copie le Markdown de la séance", async () => {
    const api = mockApi({ "GET /api/export/activity/7": () => ({ body: "## Détail de séance\n" }) });
    const user = setupUser();
    renderWithApp(<ActivityExportButton activityId={7} />);
    await user.click(screen.getByRole("button", { name: "Exporter cette séance" }));

    await waitFor(() => { expect(writeText).toHaveBeenCalledWith("## Détail de séance\n"); });
    expect(api.calls).toHaveLength(1);
    expect(await screen.findByText(/Séance copié/)).toBeInTheDocument();
  });
});

describe("Formats d'export", () => {
  it("CSV : choix de la série, lien de téléchargement et copie du texte CSV", async () => {
    const api = mockApi({ "GET /api/export": () => ({ body: "date,hrv_nuit_ms\n2026-10-15,61\n" }) });
    const user = setupUser();
    renderWithApp(<ExportButton />);
    await user.click(screen.getByRole("button", { name: "Copier pour Claude" }));
    await user.click(screen.getByLabelText("CSV (une série)"));
    await user.selectOptions(screen.getByLabelText("Série"), "hrv");
    expect(screen.getByRole("link", { name: "Télécharger (CSV)" })).toHaveAttribute(
      "href",
      "/api/export?from=2026-09-18&to=2026-10-15&format=csv&series=hrv",
    );
    await user.click(screen.getByRole("button", { name: "Copier" }));
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith("date,hrv_nuit_ms\n2026-10-15,61\n"); });
    expect(api.calls[0]?.query).toMatchObject({ format: "csv", series: "hrv" });
  });

  it("JSON : copié mis en forme", async () => {
    mockApi({ "GET /api/export": () => ({ body: { schema_version: 1, days: 28 } }) });
    const user = setupUser();
    renderWithApp(<ExportButton />);
    await user.click(screen.getByRole("button", { name: "Copier pour Claude" }));
    await user.click(screen.getByLabelText("JSON"));
    await user.click(screen.getByRole("button", { name: "Copier" }));
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith('{\n  "schema_version": 1,\n  "days": 28\n}'); });
  });

  it("widget : menu JSON / CSV, téléchargement ou message d'erreur du serveur", async () => {
    const urls: string[] = [];
    const created = vi.fn(() => "blob:x");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        urls.push(url);
        return Promise.resolve(
          url.includes("format=json")
            ? new Response(JSON.stringify({ detail: "Ce widget (« note ») n'a pas de série à exporter en JSON." }), { status: 422 })
            : new Response("date,x\n", { status: 200 }),
        );
      }),
    );
    const user = setupUser();
    renderWithApp(<WidgetExportMenu widgetId="w 1" title="Forme" />);
    await user.click(screen.getByRole("button", { name: "Autres formats : Forme" }));
    await user.click(screen.getByRole("menuitem", { name: "Télécharger en JSON" }));
    expect(await screen.findByText(/n'a pas de série à exporter en JSON/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Autres formats : Forme" }));
    await user.click(screen.getByRole("menuitem", { name: "Télécharger en CSV" }));
    await waitFor(() => { expect(created).toHaveBeenCalled(); });
    expect(urls).toEqual(["/api/export/widget/w%201?format=json", "/api/export/widget/w%201?format=csv"]);
  });
});
