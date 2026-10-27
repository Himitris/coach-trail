import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import { fetchLayout, putLayout, type LayoutResponse } from "../api/endpoints";
import { defaultLayout, sanitizeLayout } from "../layout/defaults";
import type { DashboardLayout } from "../layout/model";
import { createReducer, type LayoutAction } from "../layout/reducer";
import { LayoutSaver, type SaveStatus } from "../layout/saver";
import { HOME_WIDGET_TYPES, getWidget, specFor } from "../widgets";
import { newId } from "./ids";
import { useToast } from "./toasts";

export const SAVE_DELAY_MS = 800;

interface DashboardContextValue {
  layout: DashboardLayout;
  dispatch: Dispatch<LayoutAction>;
  saveStatus: SaveStatus;
  editMode: boolean;
  setEditMode: (value: boolean) => void;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("useDashboard doit être utilisé dans <DashboardProvider>");
  return value;
}

const reducer = createReducer(specFor);

/** Page d'accueil par défaut : programme, charge, dernières sorties, récupération, saisie du soir. */
function initialLayout(): DashboardLayout {
  const widgets = HOME_WIDGET_TYPES.map((type) => ({ id: newId(), type }));
  const layout = defaultLayout(newId(), widgets, specFor);
  // Chaque widget démarre avec ses réglages par défaut.
  for (const page of layout.pages) {
    for (const w of page.widgets) w.settings = structuredClone(getWidget(w.type)?.defaultSettings ?? {});
  }
  return layout;
}

/** Charge la disposition depuis le serveur, puis la gère localement avec sauvegarde différée. */
export function DashboardProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["layout"],
    queryFn: fetchLayout,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  if (query.isPending) {
    return (
      <div className="fullpage" role="status">
        <span className="spinner" aria-hidden="true" /> Chargement du tableau de bord…
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="fullpage" role="alert">
        <p>Impossible de charger le tableau de bord : {query.error.message}</p>
        <button type="button" className="btn" onClick={() => void query.refetch()}>
          Réessayer
        </button>
      </div>
    );
  }
  return <DashboardState initial={query.data}>{children}</DashboardState>;
}

function DashboardState({ initial, children }: { initial: LayoutResponse; children: ReactNode }) {
  const { notify } = useToast();
  const [layout, dispatch] = useReducer(reducer, initial, (init) =>
    sanitizeLayout(init.layout ?? initialLayout(), specFor),
  );
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [editMode, setEditMode] = useState(false);
  // Sans disposition côté serveur, la première (par défaut) est enregistrée aussitôt.
  const lastJson = useRef(initial.layout ? JSON.stringify(layout) : "");

  const [saver] = useState(
    () =>
      new LayoutSaver({
        put: putLayout,
        delayMs: SAVE_DELAY_MS,
        revision: initial.revision,
        onStatus: setSaveStatus,
        onConflict: (current) => {
          const clean = sanitizeLayout(current.layout ?? initialLayout(), specFor);
          lastJson.current = JSON.stringify(clean);
          saver.adopt(current.revision);
          dispatch({ type: "replace", layout: clean });
          setSaveStatus("saved");
          notify("La disposition a été modifiée depuis un autre appareil : version à jour rechargée.");
        },
      }),
  );

  useEffect(() => {
    const json = JSON.stringify(layout);
    if (json !== lastJson.current) {
      lastJson.current = json;
      saver.schedule(layout);
    }
  }, [layout, saver]);

  // Rien ne se perd si l'on recharge ou ferme la page pendant le délai d'attente.
  useEffect(() => {
    const flush = () => {
      void saver.flush(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, [saver]);

  const value = useMemo(
    () => ({ layout, dispatch, saveStatus, editMode, setEditMode }),
    [layout, saveStatus, editMode],
  );
  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}
