import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockApi } from "../test/mockApi";
import { renderWithApp } from "../test/render";
import { ActivityExportButton, ExportButton } from "./ExportButtons";

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
    expect(api.calls[0]?.query).toEqual({ from: "2026-09-18", to: "2026-10-15" }); // 4 semaines par défaut
    expect(await screen.findByText(/Export copié pour Claude/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("applique la période choisie et propose les téléchargements JSON", async () => {
    const api = mockApi({ "GET /api/export": () => ({ body: "ok" }) });
    const user = setupUser();
    renderWithApp(<ExportButton />);
    await user.click(screen.getByRole("button", { name: "Copier pour Claude" }));
    await user.click(screen.getByLabelText("7 jours"));

    expect(screen.getByRole("link", { name: "Télécharger le JSON complet" })).toHaveAttribute(
      "href",
      "/api/export?from=2026-10-09&to=2026-10-15&format=json",
    );
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
