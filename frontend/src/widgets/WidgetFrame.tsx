import { useEffect, useState } from "react";
import { exportWidget } from "../app/export";
import { WidgetExportMenu } from "../app/ExportButtons";
import { useDashboard } from "../app/DashboardProvider";
import { useToast } from "../app/toasts";
import type { WidgetInstance } from "../layout/model";
import { ImportPanel } from "../imports/ImportPanel";
import { getImportSpec } from "../imports/specs";
import { getWidget } from "./registry";
import { SettingsPanel } from "./SettingsPanel";
import { Overlay } from "./Overlay";
import { WidgetError, WidgetErrorBoundary } from "./states";

/** Cadre d'un widget : barre (titre, réglages, export, suppression) + contenu protégé des erreurs. */
export function WidgetFrame({
  pageId,
  widget,
  editMode,
}: {
  pageId: string;
  widget: WidgetInstance;
  editMode: boolean;
}) {
  const { dispatch } = useDashboard();
  const { notify } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const definition = getWidget(widget.type);

  useEffect(() => {
    if (!detailOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetailOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); };
  }, [detailOpen]);

  const remove = () => { dispatch({ type: "removeWidget", pageId, widgetId: widget.id }); };

  if (!definition) {
    return (
      <article className="widget" data-widget-type={widget.type}>
        <header className="widget-bar">
          <h2 className="widget-title">Widget inconnu</h2>
          <div className="widget-actions">
            <button type="button" className="icon-btn" aria-label="Supprimer ce widget" onClick={remove}>
              ✕
            </button>
          </div>
        </header>
        <div className="widget-body">
          <WidgetError message={`Le type de widget « ${widget.type} » n'existe plus.`} />
        </div>
      </article>
    );
  }

  const settings = { ...definition.defaultSettings, ...widget.settings };
  const importSpec = getImportSpec(definition.id);
  const hasSettings = definition.settingsSchema.length > 0;
  const { Component, Summary } = definition;
  const props = {
    instanceId: widget.id,
    settings,
    updateSettings: (patch: Record<string, unknown>) => { dispatch({ type: "updateSettings", pageId, widgetId: widget.id, patch }); },
  };

  return (
    <article className="widget" data-widget-type={widget.type}>
      <header className={`widget-bar${editMode ? " widget-handle" : ""}`}>
        <h2 className="widget-title">{definition.title}</h2>
        <div className="widget-actions">
          {hasSettings && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Réglages : ${definition.title}`}
              aria-expanded={settingsOpen}
              onClick={() => { setSettingsOpen(!settingsOpen); }}
            >
              ⚙
            </button>
          )}
          <button
            type="button"
            className="icon-btn"
            aria-label={`Exporter : ${definition.title}`}
            title="Copier les données de ce widget pour Claude"
            onClick={() => {
              void exportWidget(definition, settings).then((result) => {
                if (result.ok) notify(`« ${definition.title} » copié (${result.chars} caractères).`);
                else if (result.reason === "empty") notify("Rien à exporter pour ce widget.");
                else notify("L'export a échoué.", "error");
              });
            }}
          >
            ⤓
          </button>
          {importSpec && (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Importer : ${definition.title}`}
              title="Importer des données (fichier ou réponse de Claude)"
              onClick={() => { setImportOpen(true); }}
            >
              ⤒
            </button>
          )}
          <WidgetExportMenu widgetId={widget.id} title={definition.title} />
          {editMode && (
            <button type="button" className="icon-btn icon-btn-danger" aria-label={`Supprimer : ${definition.title}`} onClick={remove}>
              ✕
            </button>
          )}
        </div>
      </header>
      {importOpen && importSpec && (
        <ImportPanel
          spec={importSpec}
          widgetTitle={definition.title}
          updateSettings={(patch) => { dispatch({ type: "updateSettings", pageId, widgetId: widget.id, patch }); }}
          onClose={() => { setImportOpen(false); }}
        />
      )}
      {settingsOpen && hasSettings && (
        <SettingsPanel
          idPrefix={widget.id}
          schema={definition.settingsSchema}
          values={settings}
          onChange={(patch) => { dispatch({ type: "updateSettings", pageId, widgetId: widget.id, patch }); }}
        />
      )}
      <div className="widget-body">
        <WidgetErrorBoundary resetKey={widget.settings}>
          {Summary ? (
            <button
              type="button"
              className="widget-summary"
              aria-label={`Voir le détail : ${definition.title}`}
              onClick={() => { setDetailOpen(true); }}
            >
              <Summary {...props} />
              <span className="summary-more">Détails ›</span>
            </button>
          ) : (
            <Component {...props} />
          )}
        </WidgetErrorBoundary>
      </div>
      {detailOpen && Summary && (
        <Overlay onClose={() => { setDetailOpen(false); }}>
          <div
            className="dialog dialog-wide dialog-widget"
            role="dialog"
            aria-modal="true"
            aria-label={definition.title}
            onClick={(e) => { e.stopPropagation(); }}
          >
            <div className="dialog-head">
              <h2>{definition.title}</h2>
              <button type="button" className="icon-btn" aria-label="Fermer" onClick={() => { setDetailOpen(false); }}>
                ✕
              </button>
            </div>
            <WidgetErrorBoundary resetKey={widget.settings}>
              <Component {...props} />
            </WidgetErrorBoundary>
          </div>
        </Overlay>
      )}
    </article>
  );
}
