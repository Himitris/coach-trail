import { afterEach, describe, expect, it, vi } from "vitest";
import { exportActivity } from "./export";

vi.mock("../api/endpoints", () => ({
  fetchActivityExport: () => Promise.resolve("# Séance"),
  fetchExportText: () => Promise.resolve("# Export"),
}));

describe("copie dans le presse-papiers", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("replie sur execCommand quand l'API clipboard est absente (HTTP)", async () => {
    vi.stubGlobal("navigator", {});
    const exec = vi.fn(() => true);
    Object.defineProperty(document, "execCommand", { value: exec, configurable: true });
    await expect(exportActivity(1)).resolves.toEqual({ ok: true, chars: 8 });
    expect(exec).toHaveBeenCalledWith("copy");
  });

  it("signale un presse-papiers bloqué", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } });
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    await expect(exportActivity(1)).resolves.toEqual({ ok: false, reason: "clipboard" });
  });
});
