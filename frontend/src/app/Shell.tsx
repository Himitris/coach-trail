import { useCallback } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { DashboardPage } from "../pages/DashboardPage";
import { CoursesPage } from "../pages/CoursesPage";
import { DocsPage } from "../pages/DocsPage";
import { SourcesPage } from "../pages/SourcesPage";
import { ImportPage } from "../imports/ImportPanel";
import { ExportButton } from "./ExportButtons";
import { useDashboard } from "./DashboardProvider";
import { newId } from "./ids";
import { usePageShortcuts } from "./shortcuts";
import { TabBar } from "./TabBar";
import { useTheme } from "./theme";
import { useSources } from "./useSources";
import { OfflineBanner } from "./OfflineBanner";

const SAVE_LABELS = {
  saved: "Enregistré",
  dirty: "Modifications en attente…",
  saving: "Enregistrement…",
  error: "Échec de l'enregistrement, nouvelle tentative…",
} as const;

function Header() {
  const { saveStatus } = useDashboard();
  const [theme, toggleTheme] = useTheme();
  const sources = useSources();
  const badges = (sources.data ?? []).filter((s) => s.badge !== null);
  return (
    <header className="app-header">
      <Link to="/" className="brand">
        Coach Trail
      </Link>
      <div className="header-badges">
        {badges.map((s) => (
          <Link key={s.source} to="/sources" className="badge badge-warn" title={s.message ?? undefined}>
            {s.badge}
          </Link>
        ))}
      </div>
      <button
        type="button"
        className="icon-btn theme-toggle"
        aria-label={theme === "dark" ? "Passer au thème clair" : "Passer au thème sombre"}
        title={theme === "dark" ? "Thème clair" : "Thème sombre"}
        onClick={toggleTheme}
      >
        {theme === "dark" ? "☀" : "☾"}
      </button>
      <ExportButton />
      <span className={`save-status save-${saveStatus}`} aria-live="polite">
        {SAVE_LABELS[saveStatus]}
      </span>
    </header>
  );
}

function HomeRedirect() {
  const { layout, dispatch } = useDashboard();
  const home = layout.pages.find((p) => p.id === layout.home_page_id) ?? layout.pages[0];
  if (home) return <Navigate to={`/p/${home.id}`} replace />;
  return (
    <div className="empty-dashboard">
      <p>Aucune page pour l'instant.</p>
      <button type="button" className="btn btn-primary" onClick={() => { dispatch({ type: "addPage", id: newId(), title: "Accueil" }); }}>
        Créer la page d'accueil
      </button>
    </div>
  );
}

export function Shell() {
  const { layout } = useDashboard();
  const navigate = useNavigate();
  const goToPage = useCallback(
    (index: number) => {
      const page = layout.pages[index];
      if (page) void navigate(`/p/${page.id}`);
    },
    [layout.pages, navigate],
  );
  usePageShortcuts(layout.pages.length, goToPage);

  return (
    <>
      <OfflineBanner />
      <Header />
      <TabBar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/p/:pageId" element={<DashboardPage />} />
          <Route path="/calendrier" element={<Navigate to="/" replace />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/sources" element={<SourcesPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/importer" element={<ImportPage />} />
          <Route path="/plan/import" element={<Navigate to="/importer" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
