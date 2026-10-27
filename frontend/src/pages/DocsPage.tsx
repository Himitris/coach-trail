import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fullDocMarkdown, widgetSheetMarkdown } from "../docs/docMarkdown";
import { WidgetPreview } from "../docs/WidgetPreview";
import { writeClipboard } from "../app/export";
import { useToast } from "../app/toasts";
import { buildGlobalPrompt, GLOBAL_COACH_SENTENCE, GLOBAL_EXAMPLE } from "../imports/engine";
import { CopyBlock } from "../imports/ImportPanel";
import { getImportSpec } from "../imports/specs";
import { listWidgets } from "../widgets";
import { Overlay } from "../widgets/Overlay";
import type { WidgetDefinition } from "../widgets/types";

function useCopy() {
  const { notify } = useToast();
  return (text: string, label: string) => {
    void writeClipboard(text).then((ok) => {
      notify(ok ? `${label} copié.` : "Copie impossible : sélectionnez le texte à la main.", ok ? "info" : "error");
    });
  };
}

/** Documentation : un aperçu visuel par widget, l'import unique et un Markdown complet pour un agent. */
export function DocsPage() {
  const widgets = listWidgets();
  const copy = useCopy();
  const [open, setOpen] = useState<WidgetDefinition | null>(null);
  return (
    <section className="docs-page">
      <div className="toolbar">
        <h1>Documentation</h1>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-primary"
            title="Toute la documentation en un seul Markdown, à coller à un agent"
            onClick={() => { copy(fullDocMarkdown(), "Documentation"); }}
          >
            Copier la doc pour mon agent
          </button>
        </div>
      </div>

      <nav aria-label="Sommaire" className="docs-toc">
        <a href="#principe">Principe</a>
        <a href="#import">Import unique</a>
        <a href="#widgets">Widgets ({widgets.length})</a>
        <a href="#exports">Exports</a>
      </nav>

      <h2 id="principe">Principe</h2>
      <p>
        Le coach (ton projet Claude) décide ; l'appli <strong>garde et affiche</strong> ce qu'il a dit. Tu importes le plan validé
        une fois, tu le retrouves ensuite dans le <Link to="/calendrier">Calendrier</Link> et sur la page{" "}
        <Link to="/courses">Courses</Link>, sans fouiller la conversation. Tu exportes vers Claude seulement quand tu le décides.
      </p>
      <p className="hint">
        Les widgets calculés (forme, récupération, charge…) n'ont pas d'import : leurs données viennent de Garmin ou d'Intervals.icu.
      </p>

      <h2 id="import">Importer en un seul fichier</h2>
      <p>
        Donne ce prompt à Claude avec ton document : il répond par un seul JSON (plan, courses, saisies, matériel) que tu colles
        dans <Link to="/importer">Importer</Link>. L'aperçu ne modifie rien ; tu confirmes une fois.
      </p>
      <CopyBlock open title="Prompt unique à donner à Claude" hint="avec ton document" text={buildGlobalPrompt()} label="Prompt" />
      <CopyBlock title="Phrase pour mon coach" hint="à envoyer avec ta semaine ou ton document" text={GLOBAL_COACH_SENTENCE} label="Phrase" />
      <CopyBlock title="Exemple valide" hint="passe la validation" text={GLOBAL_EXAMPLE} label="Exemple" />

      <h2 id="widgets">Widgets</h2>
      <p className="hint">Clique sur « Aperçu » pour voir le widget avec des données d'exemple, ses réglages et son import.</p>
      <div className="docs-cards">
        {widgets.map((w) => {
          const spec = getImportSpec(w.id);
          return (
            <article key={w.id} className="docs-card" aria-label={w.title}>
              <h3>{w.title}</h3>
              <p>{w.description}</p>
              <p className="muted">
                {w.defaultSize.w}×{w.defaultSize.h} · {w.settingsSchema.length ? `${w.settingsSchema.length} réglage(s)` : "sans réglage"} ·
                export ⤓ · {spec ? `import ⤒ (${spec.label})` : "pas d'import"}
              </p>
              <div className="toolbar-actions">
                <button type="button" className="btn btn-small btn-primary" onClick={() => { setOpen(w); }}>
                  Aperçu
                </button>
                <button type="button" className="btn btn-small" onClick={() => { copy(widgetSheetMarkdown(w), `Fiche « ${w.title} »`); }}>
                  Copier la fiche
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <h2 id="exports">Exports</h2>
      <ul>
        <li><strong>Copier pour Claude</strong> (en-tête) : résumé Markdown d'une période (7 jours, 4 ou 12 semaines, plage libre), avec glossaire des niveaux de preuve ; formats Markdown, JSON versionné et CSV.</li>
        <li><strong>⤓ sur chaque widget</strong> : copie ses données en Markdown. <strong>Menu d'export</strong> du cadre : JSON / CSV du widget.</li>
        <li><strong>Une séance</strong> : bouton d'export dans le détail de séance ; les flux sont sous-échantillonnés dans un fichier à part.</li>
        <li>Rien n'est envoyé automatiquement : tu colles ou tu joins le résultat toi-même.</li>
      </ul>
      <p className="hint">Documents de référence dans le projet : <code>docs/plan-schema.json</code>, <code>docs/export.md</code>, <code>docs/mcp.md</code>.</p>

      {open && <WidgetSheet widget={open} onClose={() => { setOpen(null); }} />}
    </section>
  );
}

function WidgetSheet({ widget, onClose }: { widget: WidgetDefinition; onClose: () => void }) {
  const copy = useCopy();
  const spec = getImportSpec(widget.id);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return (
    <Overlay onClose={onClose}>
      <div
        className="dialog dialog-wide docs-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Fiche : ${widget.title}`}
        onClick={(event) => { event.stopPropagation(); }}
      >
        <div className="dialog-head">
          <h2>{widget.title}</h2>
          <div className="toolbar-actions">
            <button type="button" className="btn btn-small" onClick={() => { copy(widgetSheetMarkdown(widget), `Fiche « ${widget.title} »`); }}>
              Copier cette fiche
            </button>
            <button type="button" className="btn btn-small" onClick={onClose} aria-label="Fermer">✕</button>
          </div>
        </div>
        <p>{widget.description}</p>
        <WidgetPreview widget={widget} />

        <h3>Réglages</h3>
        {widget.settingsSchema.length === 0 ? (
          <p className="muted">Aucun réglage.</p>
        ) : (
          <ul>
            {widget.settingsSchema.map((f) => (
              <li key={f.key}>
                <strong>{f.label}</strong>
                {f.type === "select" && <span className="muted"> : {f.options.map((o) => o.label).join(" · ")}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          Taille par défaut {widget.defaultSize.w}×{widget.defaultSize.h} (minimum {widget.minSize.w}×{widget.minSize.h}). Export : bouton ⤓ du
          cadre, puis JSON / CSV dans son menu.
        </p>

        <h3>Import</h3>
        {spec ? (
          <>
            <p>{spec.format}</p>
            {spec.weekTemplate && (
              <p className="hint">
                Semaine type : le fichier utilise <code>"jour": "lundi"</code>… au lieu de dates ; tu choisis la semaine à remplir à l'import.
              </p>
            )}
            <CopyBlock open title="Prompt à coller dans Claude" hint="avec ton document" text={spec.prompt} label="Prompt" />
            <CopyBlock title="Phrase pour mon coach" hint="à envoyer avec ta semaine ou ton document" text={spec.coachSentence} label="Phrase" />
            <CopyBlock title="Exemple valide" hint="passe la validation" text={spec.example} label="Exemple" />
          </>
        ) : (
          <p className="muted">Pas d'import : ce widget calcule ses données depuis Garmin ou Intervals.icu.</p>
        )}
      </div>
    </Overlay>
  );
}
