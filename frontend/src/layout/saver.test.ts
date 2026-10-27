import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { LayoutResponse } from "../api/endpoints";
import { defaultLayout } from "./defaults";
import type { DashboardLayout } from "./model";
import { LayoutSaver, type SaveStatus } from "./saver";

const layoutN = (n: number): DashboardLayout => ({
  ...defaultLayout("home"),
  pages: [{ id: "home", title: `v${n}`, widgets: [], layouts: {} }],
});
const ok = (revision: number, layout: DashboardLayout): LayoutResponse => ({
  revision,
  layout,
  updated_at: null,
});

function setup(revision = 3) {
  const calls: { base: number; title: string | undefined; keepalive: boolean }[] = [];
  const statuses: SaveStatus[] = [];
  const conflicts: LayoutResponse[] = [];
  let next = revision;
  const put = vi.fn((base: number, layout: DashboardLayout, keepalive: boolean) => {
    calls.push({ base, title: layout.pages[0]?.title, keepalive });
    next += 1;
    return Promise.resolve(ok(next, layout));
  });
  const saver = new LayoutSaver({
    put,
    delayMs: 800,
    retryMs: 5000,
    revision,
    onStatus: (s) => statuses.push(s),
    onConflict: (c) => conflicts.push(c),
  });
  return { saver, put, calls, statuses, conflicts };
}

describe("LayoutSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("regroupe les modifications rapprochées en un seul envoi (la dernière version)", async () => {
    const { saver, calls, statuses } = setup();
    saver.schedule(layoutN(1));
    await vi.advanceTimersByTimeAsync(500);
    saver.schedule(layoutN(2));
    await vi.advanceTimersByTimeAsync(500);
    saver.schedule(layoutN(3));
    expect(calls).toHaveLength(0); // le délai repart à chaque modification
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toEqual([{ base: 3, title: "v3", keepalive: false }]);
    expect(saver.currentRevision).toBe(4);
    expect(statuses).toEqual(["dirty", "dirty", "dirty", "saving", "saved"]);
  });

  it("enchaîne les envois sans jamais en faire deux en parallèle", async () => {
    const { saver, calls, put } = setup();
    let release: (value: LayoutResponse) => void = () => undefined;
    put.mockImplementationOnce((base, layout) => {
      calls.push({ base, title: layout.pages[0]?.title, keepalive: false });
      return new Promise((resolve) => { release = resolve; });
    });
    saver.schedule(layoutN(1));
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toHaveLength(1);

    saver.schedule(layoutN(2)); // pendant l'envoi en cours
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toHaveLength(1); // toujours en attente de la réponse

    release(ok(4, layoutN(1)));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([
      { base: 3, title: "v1", keepalive: false },
      { base: 4, title: "v2", keepalive: false }, // révision mise à jour
    ]);
  });

  it("flush envoie tout de suite (fermeture de page) avec keepalive", async () => {
    const { saver, calls } = setup();
    saver.schedule(layoutN(1));
    await saver.flush(true);
    expect(calls).toEqual([{ base: 3, title: "v1", keepalive: true }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(1); // le minuteur a été annulé
    await saver.flush();
    expect(calls).toHaveLength(1); // rien en attente
  });

  it("un conflit (409) abandonne la version locale et rend la version du serveur", async () => {
    const { saver, put, conflicts, statuses } = setup();
    const current = ok(9, layoutN(99));
    put.mockRejectedValueOnce(new ApiError(409, { message: "autre appareil", current }, "autre appareil"));
    saver.schedule(layoutN(1));
    await vi.advanceTimersByTimeAsync(800);
    expect(conflicts).toEqual([current]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(put).toHaveBeenCalledTimes(1); // pas de nouvelle tentative
    expect(statuses.at(-1)).toBe("saving");
    saver.adopt(9);
    expect(saver.currentRevision).toBe(9);
  });

  it("réessaie après un échec réseau, sans perdre la dernière version", async () => {
    const { saver, put, calls, statuses } = setup();
    put.mockRejectedValueOnce(new ApiError(0, null, "Serveur injoignable"));
    saver.schedule(layoutN(1));
    await vi.advanceTimersByTimeAsync(800);
    expect(statuses.at(-1)).toBe("error");
    expect(calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual([{ base: 3, title: "v1", keepalive: false }]);
    expect(statuses.at(-1)).toBe("saved");
  });

  it("une modification pendant l'attente d'un nouvel essai remplace la version en attente", async () => {
    const { saver, put, calls } = setup();
    put.mockRejectedValueOnce(new ApiError(500, null, "Erreur 500"));
    saver.schedule(layoutN(1));
    await vi.advanceTimersByTimeAsync(800);
    saver.schedule(layoutN(2));
    await vi.advanceTimersByTimeAsync(800);
    expect(calls).toEqual([{ base: 3, title: "v2", keepalive: false }]);
  });
});
