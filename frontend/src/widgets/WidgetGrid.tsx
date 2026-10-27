import { useCallback, useMemo } from "react";
import { Responsive, type Layout, type Layouts } from "react-grid-layout";
import { useDashboard } from "../app/DashboardProvider";
import { sizeFor } from "../layout/defaults";
import { BREAKPOINT_MIN_WIDTH, BREAKPOINTS, COLS, type Breakpoint, type Page } from "../layout/model";
import { specFor } from "./registry";
import { WidgetFrame } from "./WidgetFrame";

const ROW_HEIGHT = 72;
const MARGIN: [number, number] = [12, 12];

/**
 * Grille d'une page. Chaque point de rupture (ordinateur / tablette / téléphone) a sa propre
 * disposition ; seules les actions de l'utilisateur (glisser, redimensionner) la modifient.
 */
export function WidgetGrid({
  page,
  width,
  bp,
  editMode,
}: {
  page: Page;
  width: number;
  bp: Breakpoint;
  editMode: boolean;
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

  return (
    <Responsive
      className={editMode ? "grid grid-editing" : "grid"}
      width={width}
      breakpoints={BREAKPOINT_MIN_WIDTH}
      cols={COLS}
      layouts={layouts}
      rowHeight={ROW_HEIGHT}
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
