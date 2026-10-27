import { useState } from "react";
import { exportWidget } from "../app/export";
import { useDashboard } from "../app/DashboardProvider";
import { useToast } from "../app/toasts";
import type { WidgetInstance } from "../layout/model";
import { getWidget } from "./registry";
import { SettingsPanel } from "./SettingsPanel";
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
  const definition = getWidget(widget.type);

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
  const hasSettings = definition.settingsSchema.length > 0;
  const { Component } = definition;

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
          {editMode && (
            <button type="button" className="icon-btn icon-btn-danger" aria-label={`Supprimer : ${definition.title}`} onClick={remove}>
              ✕
            </button>
          )}
        </div>
      </header>
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
          <Component
            instanceId={widget.id}
            settings={settings}
            updateSettings={(patch) => { dispatch({ type: "updateSettings", pageId, widgetId: widget.id, patch }); }}
          />
        </WidgetErrorBoundary>
      </div>
    </article>
  );
}
