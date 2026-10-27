import { CopyBlock } from "../imports/ImportPanel";
import { getImportSpec, listImportSpecs } from "../imports/specs";
import { listWidgets } from "../widgets";

/** Documentation : tous les widgets, leurs réglages, leur export et leur import (prompts à copier). */
export function DocsPage() {
  const widgets = listWidgets();
  const specs = listImportSpecs();
  return (
    <section className="docs-page">
      <div className="toolbar">
        <h1>Documentation</h1>
      </div>

      <nav aria-label="Sommaire" className="docs-toc">
        <a href="#principe">Principe</a>
        <a href="#widgets">Widgets ({widgets.length})</a>
        <a href="#imports">Imports et prompts ({specs.length})</a>
        <a href="#exports">Exports</a>
      </nav>

      <h2 id="principe">Principe</h2>
      <p>
        Chaque widget peut <strong>exporter</strong> ses données vers Claude (bouton ⤓) et, quand c'est pertinent,{" "}
        <strong>importer</strong> des données (bouton ⤒). L'import suit toujours les mêmes étapes : on dépose un fichier
        (ou on colle la réponse de Claude), l'appli vérifie le format et affiche un aperçu <em>sans rien écrire</em>, puis
        on confirme. Le panneau d'import propose le prompt de format à coller dans Claude et une phrase à envoyer à son
        coach.
      </p>
      <p className="hint">
        Les widgets calculés (forme, récupération, charge…) n'ont pas d'import : leurs données viennent de Garmin ou
        d'Intervals.icu.
      </p>

      <h2 id="widgets">Widgets</h2>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Widget</th>
              <th scope="col">Contenu</th>
              <th scope="col">Réglages</th>
              <th scope="col">Taille</th>
              <th scope="col">Export</th>
              <th scope="col">Import</th>
            </tr>
          </thead>
          <tbody>
            {widgets.map((w) => {
              const spec = getImportSpec(w.id);
              return (
                <tr key={w.id}>
                  <th scope="row">{w.title}</th>
                  <td>{w.description}</td>
                  <td>{w.settingsSchema.length ? w.settingsSchema.map((f) => f.label).join(", ") : "—"}</td>
                  <td>{w.defaultSize.w}×{w.defaultSize.h}</td>
                  <td>Oui (⤓)</td>
                  <td>{spec ? <a href={`#import-${w.id}`}>{spec.label}</a> : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 id="imports">Imports et prompts</h2>
      <p className="hint">
        Pour chaque import : le <strong>prompt</strong> à coller dans Claude avec ton document, la <strong>phrase</strong>{" "}
        à donner à ton coach, et un <strong>exemple</strong> valide. Les fichiers sont des JSON versionnés
        (<code>"version": 1</code>) ; tout champ inconnu ou invalide est signalé en français avant l'enregistrement.
      </p>
      {specs.map((spec) => {
        const widget = widgets.find((w) => w.id === spec.widgetId);
        return (
          <article key={spec.widgetId} id={`import-${spec.widgetId}`} className="docs-import">
            <h3>{widget?.title ?? spec.widgetId} — {spec.label}</h3>
            <p>{spec.format}</p>
            {spec.weekTemplate && (
              <p className="hint">
                Semaine type : le fichier utilise <code>"jour": "lundi"</code>… au lieu de dates. À l'import, tu choisis
                la semaine à remplir : tu peux donc réimporter le même document chaque semaine.
              </p>
            )}
            <CopyBlock open title="Prompt à coller dans Claude" hint="avec ton document" text={spec.prompt} label="Prompt" />
            <CopyBlock title="Phrase pour mon coach" hint="à envoyer avec ta semaine ou ton document" text={spec.coachSentence} label="Phrase" />
            <CopyBlock title="Exemple valide" hint="passe la validation" text={spec.example} label="Exemple" />
          </article>
        );
      })}

      <h2 id="exports">Exports</h2>
      <ul>
        <li><strong>Copier pour Claude</strong> (en-tête) : résumé Markdown d'une période (7 jours, 4 ou 12 semaines, plage libre), avec glossaire des niveaux de preuve ; formats Markdown, JSON versionné et CSV.</li>
        <li><strong>⤓ sur chaque widget</strong> : copie ses données en Markdown. <strong>Menu d'export</strong> du cadre : JSON / CSV du widget.</li>
        <li><strong>Une séance</strong> : bouton d'export dans le détail de séance ; les flux sont sous-échantillonnés dans un fichier à part.</li>
        <li>Rien n'est envoyé automatiquement : tu colles ou tu joins le résultat toi-même.</li>
      </ul>
      <p className="hint">Documents de référence dans le projet : <code>docs/plan-schema.json</code>, <code>docs/export.md</code>, <code>docs/mcp.md</code>.</p>
    </section>
  );
}
