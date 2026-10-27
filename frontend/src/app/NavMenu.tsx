import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useMatch } from "react-router-dom";
import { useDashboard } from "./DashboardProvider";
import { shortcutLabel } from "./shortcuts";
import { useSources } from "./useSources";

const SECTIONS = [
  { to: "/courses", label: "Courses", hint: "Courses et plans attribués" },
  { to: "/importer", label: "Importer", hint: "Plan, courses, saisies ou matériel produits par Claude" },
  { to: "/docs", label: "Documentation", hint: "Widgets, imports et prompts" },
  { to: "/sources", label: "Sources", hint: "Garmin, Intervals.icu, Strava, import FIT/GPX" },
] as const;

/** Menu unique : pages du tableau de bord et autres écrans. Fiche plein écran sur téléphone. */
export function NavMenu() {
  const { layout } = useDashboard();
  const sources = useSources();
  const location = useLocation();
  const pageMatch = useMatch("/p/:pageId");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const attention = (sources.data ?? []).some((s) => s.state === "auth_required" || s.state === "down");
  const current =
    layout.pages.find((p) => p.id === pageMatch?.params.pageId)?.title ??
    SECTIONS.find((s) => location.pathname.startsWith(s.to))?.label ??
    "Menu";

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="nav-menu-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open); }}
      >
        <span className="nav-menu-icon" aria-hidden="true">☰</span>
        <span className="nav-menu-current">{current}</span>
        <span className="nav-menu-label">Menu</span>
        {attention && <span className="dot dot-warn" aria-label="Attention requise" />}
      </button>
      {open &&
        createPortal(
          <div className="nav-menu-backdrop" onClick={() => { setOpen(false); }}>
            <nav
              className="nav-menu"
              role="dialog"
              aria-label="Menu de navigation"
              onClick={(event) => { event.stopPropagation(); }}
            >
              <div className="nav-menu-head">
                <strong>Menu</strong>
                <button type="button" className="btn btn-small" aria-label="Fermer le menu" onClick={() => { setOpen(false); }}>
                  ✕
                </button>
              </div>
              <h2 className="nav-menu-title">Pages</h2>
              <ul>
                {layout.pages.map((page, index) => (
                  <li key={page.id}>
                    <Link to={`/p/${page.id}`} aria-current={page.id === pageMatch?.params.pageId ? "page" : undefined}>
                      <span>{page.title}{layout.home_page_id === page.id ? " ⌂" : ""}</span>
                      {shortcutLabel(index) && <kbd>{shortcutLabel(index)}</kbd>}
                    </Link>
                  </li>
                ))}
              </ul>
              <h2 className="nav-menu-title">Outils</h2>
              <ul>
                {SECTIONS.map((s) => (
                  <li key={s.to}>
                    <Link to={s.to} aria-current={location.pathname.startsWith(s.to) ? "page" : undefined}>
                      <span>
                        {s.label}
                        {s.to === "/sources" && attention && <span className="dot dot-warn" aria-label="Attention requise" />}
                      </span>
                      <small className="muted">{s.hint}</small>
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>,
          document.body,
        )}
    </>
  );
}
