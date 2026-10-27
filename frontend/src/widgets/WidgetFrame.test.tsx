import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../app/toasts";
import type { WidgetInstance } from "../layout/model";
import { clearRegistry, registerWidget } from "./registry";
import { WidgetFrame } from "./WidgetFrame";
import { WidgetEmpty, WidgetLoading } from "./states";

const dispatch = vi.fn();
vi.mock("../app/DashboardProvider", () => ({
  useDashboard: () => ({ dispatch, layout: { pages: [], home_page_id: null }, saveStatus: "saved", editMode: false }),
}));

function Boom(): never {
  throw new Error("plantage volontaire");
}

const widget = (id: string, type: string, settings: Record<string, unknown> = {}): WidgetInstance => ({
  id,
  type,
  settings,
});

beforeEach(() => {
  clearRegistry();
  dispatch.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  registerWidget({
    id: "ok",
    title: "Widget sain",
    description: "",
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 2, h: 2 },
    defaultSettings: { period: "4w" },
    settingsSchema: [
      {
        key: "period",
        label: "Période",
        type: "select",
        options: [
          { value: "4w", label: "4 semaines" },
          { value: "8w", label: "8 semaines" },
        ],
      },
    ],
    Component: () => <p>contenu sain</p>,
    exportData: (s) => ({ title: "Sain", markdown: `période ${s.period}` }),
  });
  registerWidget({
    id: "boom",
    title: "Widget cassé",
    description: "",
    defaultSize: { w: 4, h: 3 },
    minSize: { w: 2, h: 2 },
    defaultSettings: {},
    settingsSchema: [],
    Component: Boom,
    exportData: () => null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const renderFrames = (editMode = false) =>
  render(
    <ToastProvider>
      <WidgetFrame pageId="p" widget={widget("w1", "ok")} editMode={editMode} />
      <WidgetFrame pageId="p" widget={widget("w2", "boom")} editMode={editMode} />
      <WidgetFrame pageId="p" widget={widget("w3", "disparu")} editMode={editMode} />
    </ToastProvider>,
  );

describe("WidgetFrame", () => {
  it("un widget en erreur n'empêche pas les autres de s'afficher", () => {
    renderFrames();
    expect(screen.getByText("contenu sain")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(2); // widget cassé + widget inconnu
    expect(screen.getByText("Impossible d'afficher ce widget.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
    // le cadre cassé garde son titre et ses boutons
    expect(screen.getByText("Widget cassé")).toBeInTheDocument();
  });

  it("signale un type de widget inconnu et permet de le supprimer", () => {
    renderFrames();
    expect(screen.getByText(/« disparu » n'existe plus/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Supprimer ce widget" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "removeWidget", pageId: "p", widgetId: "w3" });
  });

  it("le bouton de suppression n'apparaît qu'en mode édition, un clic suffit", () => {
    const { unmount } = renderFrames(false);
    expect(screen.queryByRole("button", { name: "Supprimer : Widget sain" })).toBeNull();
    unmount();
    renderFrames(true);
    fireEvent.click(screen.getByRole("button", { name: "Supprimer : Widget sain" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "removeWidget", pageId: "p", widgetId: "w1" });
  });

  it("la roue ouvre un formulaire généré depuis le schéma et enregistre le changement", () => {
    renderFrames();
    expect(screen.queryByLabelText("Période")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Réglages : Widget sain" }));
    fireEvent.change(screen.getByLabelText("Période"), { target: { value: "8w" } });
    expect(dispatch).toHaveBeenCalledWith({
      type: "updateSettings",
      pageId: "p",
      widgetId: "w1",
      patch: { period: "8w" },
    });
    // pas de roue pour un widget sans réglages
    expect(screen.queryByRole("button", { name: "Réglages : Widget cassé" })).toBeNull();
  });

  it("le bouton d'export appelle exportData et copie le résultat", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderFrames();
    fireEvent.click(screen.getByRole("button", { name: "Exporter : Widget sain" }));
    await waitFor(() => { expect(writeText).toHaveBeenCalledWith("période 4w"); });
    expect(await screen.findByText(/« Widget sain » copié/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Exporter : Widget cassé" }));
    expect(await screen.findByText("Rien à exporter pour ce widget.")).toBeInTheDocument();
  });
});

describe("états homogènes", () => {
  it("chargement, vide et erreur ont des rôles accessibles", () => {
    render(
      <>
        <WidgetLoading />
        <WidgetEmpty message="Aucune sortie" />
      </>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Chargement…");
    expect(screen.getByText("Aucune sortie")).toBeInTheDocument();
  });
});
