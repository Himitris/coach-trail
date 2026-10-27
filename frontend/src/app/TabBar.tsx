import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useMatch, useNavigate } from "react-router-dom";
import { MAX_PAGE_TITLE } from "../layout/reducer";
import { useDashboard } from "./DashboardProvider";
import { newId } from "./ids";
import { shortcutLabel } from "./shortcuts";
import { useSources } from "./useSources";

/** Barre d'onglets fixe : une page par onglet, glisser pour réordonner, menu ⋯ pour le reste. */
export function TabBar() {
  const { layout, dispatch } = useDashboard();
  const navigate = useNavigate();
  const pageMatch = useMatch("/p/:pageId");
  const sourcesMatch = useMatch("/sources");
  const coursesMatch = useMatch("/courses");
  const importMatch = useMatch("/plan/import");
  const docsMatch = useMatch("/docs");
  const sources = useSources();
  const activeId = pageMatch?.params.pageId;
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const attention = (sources.data ?? []).some((s) => s.state === "auth_required" || s.state === "down");

  const createPage = () => {
    const id = newId();
    dispatch({ type: "addPage", id });
    void navigate(`/p/${id}`);
    setRenamingId(id);
  };

  const deletePage = (id: string) => {
    const page = layout.pages.find((p) => p.id === id);
    if (!page) return;
    const widgets = page.widgets.length;
    if (!window.confirm(`Supprimer la page « ${page.title} » et ses ${widgets} widget(s) ?`)) return;
    dispatch({ type: "deletePage", id });
    if (activeId === id) void navigate("/");
  };

  return (
    <nav className="tabbar" aria-label="Pages du tableau de bord">
      <div className="tabs" role="tablist">
        {layout.pages.map((page, index) => {
          const active = page.id === activeId;
          return (
            <div
              key={page.id}
              className={`tab${active ? " tab-active" : ""}${dragId === page.id ? " tab-dragging" : ""}`}
              draggable={renamingId !== page.id}
              onDragStart={(event) => {
                setDragId(page.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", page.id);
              }}
              onDragOver={(event) => {
                if (dragId) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragId && dragId !== page.id) dispatch({ type: "movePage", id: dragId, toIndex: index });
                setDragId(null);
              }}
              onDragEnd={() => { setDragId(null); }}
            >
              {renamingId === page.id ? (
                <RenameInput
                  initial={page.title}
                  onDone={(title) => {
                    if (title !== null) dispatch({ type: "renamePage", id: page.id, title });
                    setRenamingId(null);
                  }}
                />
              ) : (
                <Link
                  to={`/p/${page.id}`}
                  role="tab"
                  aria-selected={active}
                  title={shortcutLabel(index) ? `Raccourci : touche ${shortcutLabel(index) ?? ""} (ou ${index + 1})` : undefined}
                  onDoubleClick={() => { setRenamingId(page.id); }}
                >
                  {shortcutLabel(index) && <span className="tab-index" aria-hidden="true">{shortcutLabel(index)}</span>}
                  {page.title}
                  {layout.home_page_id === page.id && <span className="tab-home" title="Page d'accueil"> ⌂</span>}
                </Link>
              )}
              {active && renamingId !== page.id && (
                <button
                  type="button"
                  className="tab-menu-btn"
                  aria-label={`Actions de la page ${page.title}`}
                  aria-haspopup="menu"
                  aria-expanded={menuId === page.id}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    setMenuPos({ top: rect.bottom + 2, left: Math.max(4, Math.min(rect.left, window.innerWidth - 232)) });
                    setMenuId(menuId === page.id ? null : page.id);
                  }}
                >
                  ⋯
                </button>
              )}
              {menuId === page.id && (
                <PageMenu
                  pos={menuPos}
                  isFirst={index === 0}
                  isLast={index === layout.pages.length - 1}
                  isHome={layout.home_page_id === page.id}
                  onClose={() => { setMenuId(null); }}
                  onRename={() => { setRenamingId(page.id); }}
                  onDuplicate={() => {
                    const newPageId = newId();
                    dispatch({ type: "duplicatePage", id: page.id, newId: newPageId });
                    void navigate(`/p/${newPageId}`);
                  }}
                  onHome={() => { dispatch({ type: "setHome", id: page.id }); }}
                  onMove={(delta) => { dispatch({ type: "movePage", id: page.id, toIndex: index + delta }); }}
                  onDelete={() => { deletePage(page.id); }}
                />
              )}
            </div>
          );
        })}
        <button type="button" className="tab tab-add" onClick={createPage} aria-label="Nouvelle page" title="Nouvelle page">
          +
        </button>
      </div>
      <Link to="/courses" className={`tab tab-sources${coursesMatch ? " tab-active" : ""}`} title="Courses et plans attribués">
        Courses
      </Link>
      <Link
        to="/plan/import"
        className={`tab tab-sources${importMatch ? " tab-active" : ""}`}
        title="Importer un plan JSON produit par Claude"
        aria-label="Importer un plan"
      >
        Plan
      </Link>
      <Link to="/docs" className={`tab tab-sources${docsMatch ? " tab-active" : ""}`} title="Widgets, imports et prompts">
        Doc
      </Link>
      <Link to="/sources" className={`tab tab-sources${sourcesMatch ? " tab-active" : ""}`}>
        Sources{attention && <span className="dot dot-warn" aria-label="Attention requise" />}
      </Link>
    </nav>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    onDone(value);
  };
  return (
    <input
      ref={ref}
      className="tab-rename"
      aria-label="Nom de la page"
      defaultValue={initial}
      maxLength={MAX_PAGE_TITLE}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(event.currentTarget.value);
        if (event.key === "Escape") finish(null);
      }}
      onBlur={(event) => { finish(event.currentTarget.value); }}
    />
  );
}

function PageMenu(props: {
  pos: { top: number; left: number };
  isFirst: boolean;
  isLast: boolean;
  isHome: boolean;
  onClose: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onHome: () => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { onClose } = props;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const onClick = () => { onClose(); };
    window.addEventListener("keydown", onKey);
    // Un clic ailleurs ferme le menu (différé pour ne pas capter le clic d'ouverture).
    const timer = setTimeout(() => { window.addEventListener("click", onClick); }, 0);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [onClose]);

  const item = (label: string, action: () => void, disabled = false) => (
    <button type="button" role="menuitem" disabled={disabled} onClick={() => { action(); onClose(); }}>
      {label}
    </button>
  );
  // Rendu dans <body> : la barre d'onglets (overflow) rognerait un menu positionné dans ses cadres.
  return createPortal(
    <div className="menu menu-floating" role="menu" style={{ top: props.pos.top, left: props.pos.left }}>
      {item("Renommer", props.onRename)}
      {item("Dupliquer", props.onDuplicate)}
      {item(props.isHome ? "Page d'accueil actuelle" : "Définir comme accueil", props.onHome, props.isHome)}
      {item("Déplacer vers la gauche", () => { props.onMove(-1); }, props.isFirst)}
      {item("Déplacer vers la droite", () => { props.onMove(1); }, props.isLast)}
      {item("Supprimer", props.onDelete)}
    </div>,
    document.body,
  );
}
