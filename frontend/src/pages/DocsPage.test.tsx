import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fullDocMarkdown, widgetSheetMarkdown } from "../docs/docMarkdown";
import { ToastProvider } from "../app/toasts";
import { GLOBAL_EXAMPLE } from "../imports/engine";
import { listImportSpecs } from "../imports/specs";
import { listWidgets } from "../widgets";
import { DocsPage } from "./DocsPage";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mount = () =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <DocsPage />
      </ToastProvider>
    </MemoryRouter>,
  );

describe("Documentation", () => {
  it("une carte par widget avec Aperçu et Copier la fiche, et l'import unique en tête", () => {
    mount();
    for (const widget of listWidgets()) {
      const card = screen.getByRole("article", { name: widget.title });
      expect(within(card).getByRole("button", { name: "Aperçu" })).toBeInTheDocument();
      expect(within(card).getByRole("button", { name: "Copier la fiche" })).toBeInTheDocument();
    }
    expect(screen.getByText("Prompt unique à donner à Claude")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copier la doc pour mon agent" })).toBeInTheDocument();
  });

  it("chaque import correspond à un widget existant", () => {
    const ids = new Set(listWidgets().map((w) => w.id));
    for (const spec of listImportSpecs()) expect(ids.has(spec.widgetId)).toBe(true);
  });

  it("l'aperçu de chaque widget affiche le vrai composant avec des données d'exemple, sans appeler le serveur", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("réseau interdit")));
    vi.stubGlobal("fetch", fetchMock);
    mount();
    for (const widget of listWidgets()) {
      await userEvent.click(within(screen.getByRole("article", { name: widget.title })).getByRole("button", { name: "Aperçu" }));
      const dialog = await screen.findByRole("dialog", { name: `Fiche : ${widget.title}` });
      const preview = within(dialog).getByRole("article", { name: `Aperçu : ${widget.title}` });
      expect(within(preview).getByText("Données d'exemple")).toBeInTheDocument();
      await waitFor(() => { expect(preview.querySelector(".spinner")).toBeNull(); }, { timeout: 4000 });
      expect(preview.querySelector(".widget-state-error"), `erreur dans l'aperçu de « ${widget.title} »`).toBeNull();
      expect(preview.querySelector(".widget-body")).toHaveAttribute("inert");
      await userEvent.click(within(dialog).getByRole("button", { name: "Fermer" }));
      await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  }, 60_000);

  it("la fiche montre les réglages, l'import et copie le Markdown de la fiche", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount();
    await userEvent.click(within(screen.getByRole("article", { name: "Programme de la semaine" })).getByRole("button", { name: "Aperçu" }));
    const dialog = await screen.findByRole("dialog", { name: "Fiche : Programme de la semaine" });
    expect(await within(dialog).findByText("Footing facile")).toBeInTheDocument(); // donnée d'exemple
    expect(within(dialog).getByText(/Séances prévues|Plan de séances/)).toBeInTheDocument();
    expect(within(dialog).getByText("Prompt à coller dans Claude")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Copier cette fiche" }));
    await waitFor(() => { expect(writeText).toHaveBeenCalledTimes(1); });
    const copied = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(copied).toContain("## Widget « Programme de la semaine »");
    expect(copied).toContain("### Import");
  });

  it("Échap ferme la fiche", async () => {
    mount();
    await userEvent.click(within(screen.getByRole("article", { name: "Note libre" })).getByRole("button", { name: "Aperçu" }));
    await screen.findByRole("dialog", { name: "Fiche : Note libre" });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
  });

  it("« Copier la doc pour mon agent » copie la documentation complète", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Copier la doc pour mon agent" }));
    await waitFor(() => { expect(writeText).toHaveBeenCalledTimes(1); });
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toBe(fullDocMarkdown());
  });
});

describe("Markdown de la documentation", () => {
  const doc = fullDocMarkdown();

  it("contient chaque widget (titre, identifiant, réglages) et chaque format d'import", () => {
    for (const widget of listWidgets()) {
      expect(doc).toContain(`## Widget « ${widget.title} » (\`${widget.id}\`)`);
      for (const field of widget.settingsSchema) expect(doc).toContain(`\`${field.key}\``);
    }
    for (const spec of listImportSpecs()) {
      expect(doc).toContain(`### Import « ${spec.label} »`);
      expect(doc).toContain(spec.prompt);
      expect(doc).toContain(spec.example);
    }
  });

  it("décrit l'import unique, les pages et les règles métriques", () => {
    expect(doc).toContain(GLOBAL_EXAMPLE);
    expect(doc).toContain("Import unique");
    expect(doc).toMatch(/Courses.*Menu/s);
    expect(doc).toContain("`&` `é`");
    expect(doc).toContain("Vérifier les nouveautés");
    expect(doc).toContain("Pas d'alerte de blessure");
    expect(doc.startsWith("# Coach Trail")).toBe(true);
  });

  it("une fiche sans import le dit", () => {
    const widget = listWidgets().find((w) => !listImportSpecs().some((s) => s.widgetId === w.id));
    expect(widget).toBeDefined();
    if (widget) expect(widgetSheetMarkdown(widget)).toContain("Import : aucun");
  });

  it("les blocs de code sont bien fermés", () => {
    expect((doc.match(/```/g) ?? []).length % 2).toBe(0);
  });
});
