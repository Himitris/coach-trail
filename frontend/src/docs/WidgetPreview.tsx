import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useLayoutEffect, useMemo, useRef } from "react";
import { setDemoHandler } from "../api/client";
import { WidgetErrorBoundary } from "../widgets/states";
import type { WidgetDefinition } from "../widgets/types";
import { demoResponse, demoSettings } from "./demoData";

const ROW = 72;
const GAP = 12;

/**
 * Aperçu d'un widget avec des données d'exemple : le vrai composant, rendu non interactif, dans un
 * cadre de sa taille par défaut. Les requêtes sont servies par `demoResponse`, jamais par le serveur.
 */
export function WidgetPreview({ widget }: { widget: WidgetDefinition }) {
  const client = useMemo(
    () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnWindowFocus: false } } }),
    [],
  );
  const body = useRef<HTMLDivElement>(null);
  // Avant le premier chargement des widgets (effets passifs) : les requêtes partent déjà en démo.
  useLayoutEffect(() => {
    setDemoHandler(demoResponse);
    body.current?.setAttribute("inert", "");
    return () => { setDemoHandler(null); client.clear(); };
  }, [client]);
  const { Component } = widget;
  const width = Math.round((widget.defaultSize.w / 12) * 1100);
  const height = widget.defaultSize.h * ROW + (widget.defaultSize.h - 1) * GAP;
  return (
    <QueryClientProvider client={client}>
      <article className="widget widget-preview" style={{ maxWidth: width, height }} aria-label={`Aperçu : ${widget.title}`}>
        <header className="widget-bar">
          <h2 className="widget-title">{widget.title}</h2>
          <span className="badge">Données d'exemple</span>
        </header>
        <div className="widget-body" ref={body} aria-hidden="true">
          <WidgetErrorBoundary>
            <Component instanceId="demo" settings={{ ...widget.defaultSettings, ...demoSettings(widget.id) }} updateSettings={() => undefined} />
          </WidgetErrorBoundary>
        </div>
      </article>
    </QueryClientProvider>
  );
}
