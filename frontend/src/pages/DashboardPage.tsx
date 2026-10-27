import { useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useDashboard } from "../app/DashboardProvider";
import { newId } from "../app/ids";
import { AddWidgetDialog } from "../widgets/AddWidgetDialog";
import { WidgetGrid } from "../widgets/WidgetGrid";
import { BREAKPOINT_LABELS, breakpointForWidth } from "../layout/model";

/** Largeur du conteneur, suivie à la volée (la grille choisit sa disposition d'après elle). */
function useContainerWidth(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => { setWidth(element.clientWidth); };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => { window.removeEventListener("resize", measure); };
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, []);
  return [ref, width];
}

export function DashboardPage() {
  const { pageId } = useParams();
  const { layout, dispatch, editMode, setEditMode } = useDashboard();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [containerRef, width] = useContainerWidth();
  const page = layout.pages.find((p) => p.id === pageId);
  if (!page) return <Navigate to="/" replace />;

  const bp = breakpointForWidth(width);
  const bpLabel = BREAKPOINT_LABELS[bp];

  return (
    <section className="dashboard" aria-label={page.title}>
      <div className="toolbar">
        <h1>{page.title}</h1>
        <div className="toolbar-actions">
          {editMode && (
            <>
              <button type="button" className="btn" onClick={() => { setCatalogOpen(true); }}>
                + Widget
              </button>
              <button
                type="button"
                className="btn"
                title={`Remet les widgets de cette page à leur place par défaut, pour l'affichage ${bpLabel} uniquement`}
                onClick={() => {
                  if (window.confirm(`Réinitialiser la disposition par défaut (affichage ${bpLabel}) ?`)) {
                    dispatch({ type: "resetBreakpoint", pageId: page.id, bp });
                  }
                }}
              >
                Réinitialiser la disposition ({bpLabel})
              </button>
            </>
          )}
          <button
            type="button"
            className={`btn${editMode ? " btn-primary" : ""}`}
            aria-pressed={editMode}
            onClick={() => { setEditMode(!editMode); }}
          >
            {editMode ? "Terminer" : "Modifier la disposition"}
          </button>
        </div>
      </div>
      {editMode && (
        <p className="hint">
          Mode édition ({bpLabel}) : faites glisser les cadres par leur titre, redimensionnez-les par le coin. Chaque
          type d'écran garde sa propre disposition.
        </p>
      )}
      <div ref={containerRef} className="grid-area">
        {page.widgets.length === 0 ? (
          <div className="empty-dashboard">
            <p>Cette page est vide.</p>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setEditMode(true);
                setCatalogOpen(true);
              }}
            >
              + Ajouter un widget
            </button>
          </div>
        ) : (
          width > 0 && <WidgetGrid page={page} width={width} bp={bp} editMode={editMode} />
        )}
      </div>
      {catalogOpen && (
        <AddWidgetDialog
          onClose={() => { setCatalogOpen(false); }}
          onPick={(widgetType, defaultSettings) => {
            dispatch({
              type: "addWidget",
              pageId: page.id,
              widgetId: newId(),
              widgetType,
              settings: defaultSettings,
            });
            setCatalogOpen(false);
          }}
        />
      )}
    </section>
  );
}
