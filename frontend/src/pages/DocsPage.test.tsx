import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ToastProvider } from "../app/toasts";
import { listImportSpecs } from "../imports/specs";
import { listWidgets } from "../widgets";
import { DocsPage } from "./DocsPage";

describe("Documentation", () => {
  it("liste tous les widgets et le prompt de chaque import", () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <DocsPage />
        </ToastProvider>
      </MemoryRouter>,
    );
    for (const widget of listWidgets()) {
      expect(screen.getAllByText(widget.title).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Prompt à coller dans Claude")).toHaveLength(listImportSpecs().length);
  });

  it("chaque import correspond à un widget existant", () => {
    const ids = new Set(listWidgets().map((w) => w.id));
    for (const spec of listImportSpecs()) expect(ids.has(spec.widgetId)).toBe(true);
  });
});
