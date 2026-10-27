import { ApiError } from "../api/client";
import type { LayoutResponse } from "../api/endpoints";
import type { DashboardLayout } from "./model";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

export interface SaverOptions {
  /** Envoie la disposition ; `baseRevision` = dernière révision connue du serveur. */
  put: (baseRevision: number, layout: DashboardLayout, keepalive: boolean) => Promise<LayoutResponse>;
  /** Attente après la dernière modification avant d'envoyer (anti-rebond). */
  delayMs: number;
  /** Attente avant de réessayer après un échec réseau. */
  retryMs?: number;
  revision: number;
  onStatus: (status: SaveStatus) => void;
  /** Une autre session a écrit entre-temps : le serveur renvoie sa version, la nôtre est abandonnée. */
  onConflict: (current: LayoutResponse) => void;
}

/**
 * Sauvegarde différée de la disposition : plusieurs modifications rapprochées = un seul envoi,
 * jamais deux envois en parallèle, toujours la dernière version.
 */
export class LayoutSaver {
  private revision: number;
  private pending: DashboardLayout | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly options: SaverOptions) {
    this.revision = options.revision;
  }

  get currentRevision(): number {
    return this.revision;
  }

  /** Révision à utiliser après un remplacement par la version du serveur. */
  adopt(revision: number): void {
    this.revision = revision;
    this.pending = null;
    this.clearTimer();
  }

  schedule(layout: DashboardLayout): void {
    this.pending = layout;
    this.options.onStatus("dirty");
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.options.delayMs);
  }

  /** Envoie tout de suite ce qui est en attente ; résout quand la file est vide. */
  flush(keepalive = false): Promise<void> {
    this.clearTimer();
    this.running ??= this.drain(keepalive).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  dispose(): void {
    this.clearTimer();
    this.pending = null;
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async drain(keepalive: boolean): Promise<void> {
    while (this.pending) {
      const layout = this.pending;
      this.pending = null;
      this.options.onStatus("saving");
      try {
        const saved = await this.options.put(this.revision, layout, keepalive);
        this.revision = saved.revision;
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          this.pending = null;
          const current = (error.detail as { current?: LayoutResponse } | null)?.current;
          if (current) this.options.onConflict(current);
          return;
        }
        // Échec réseau ou serveur : on garde la version (sauf si une plus récente l'a remplacée).
        this.pending ??= layout;
        this.options.onStatus("error");
        this.timer = setTimeout(() => {
          this.timer = null;
          void this.flush();
        }, this.options.retryMs ?? 5000);
        return;
      }
    }
    this.options.onStatus("saved");
  }
}
