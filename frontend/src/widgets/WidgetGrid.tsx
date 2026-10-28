import { useCallback, useMemo } from "react";
import { Responsive, type Layout, type Layouts } from "react-grid-layout";
import { useDashboard } from "../app/DashboardProvider";
import { sizeFor } from "../layout/defaults";
import { BREAKPOINT_MIN_WIDTH, BREAKPOINTS, COLS, type Breakpoint, type Page } from "../layout/model";
import { specFor } from "./registry";
import { WidgetFrame } from "./WidgetFrame";

const ROW_HEIGHT = 72;
const MIN_ROW_HEIGHT = 44;
const MAX_ROW_HEIGHT = 220;
const MARGIN: [number, number] = [8, 8];

/** Hauteur de ligne pour que toutes les lignes tiennent dans la hauteur disponible (sans défilement). */
export function fitRowHeight(rows: number, availableHeight: number | undefined): number {
  if (!availableHeight || rows < 1) return ROW_HEIGHT;
  const fit = Math.floor((availableHeight - MARGIN[1] * (rows - 1)) / rows);
  return Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, fit));
}

/**
 * Grille d'une page. Chaque point de rupture (ordinateur / tablette / téléphone) a sa propre
 * disposition ; seules les actions de l'utilisateur (glisser, redimensionner) la modifient.
 */
export function WidgetGrid({
  page,
  width,
  bp,
  editMode,
  availableHeight,
}: {
  page: Page;
  width: number;
  bp: Breakpoint;
  editMode: boolean;
  /** Hauteur de l'écran restante : la grille s'y adapte (ordinateur et tablette). */
  availableHeight?: number;
}) {
  const { dispatch } = useDashboard();

  const layouts = useMemo<Layouts>(() => {
    const out: Layouts = {};
    for (const point of BREAKPOINTS) {
      out[point] = (page.layouts[point] ?? []).map((item) => {
        const widget = page.widgets.find((w) => w.id === item.i);
        const { minW, minH } = sizeFor(point, specFor(widget?.type ?? ""));
        return { ...item, minW, minH, static: !editMode };
      });
    }
    return out;
  }, [page.layouts, page.widgets, editMode]);

  const commit = useCallback(
    (layout: Layout[]) => {
      dispatch({
        type: "setBreakpointLayout",
        pageId: page.id,
        bp,
        items: layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })),
      });
    },
    [dispatch, page.id, bp],
  );

  const rows = Math.max(0, ...(page.layouts[bp] ?? []).map((item) => item.y + item.h));
  const rowHeight = bp === "sm" ? ROW_HEIGHT : fitRowHeight(rows, availableHeight);

  return (
    <Responsive
      className={editMode ? "grid grid-editing" : "grid"}
      width={width}
      breakpoints={BREAKPOINT_MIN_WIDTH}
      cols={COLS}
      layouts={layouts}
      rowHeight={rowHeight}
      margin={MARGIN}
      containerPadding={[0, 0]}
      compactType="vertical"
      isDraggable={editMode}
      isResizable={editMode}
      draggableHandle=".widget-handle"
      draggableCancel=".widget-actions"
      onDragStop={commit}
      onResizeStop={commit}
    >
      {page.widgets.map((widget) => (
        <div key={widget.id}>
          <WidgetFrame pageId={page.id} widget={widget} editMode={editMode} />
        </div>
      ))}
    </Responsive>
  );
}
