import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type DragEvent } from "react";
import { ApiError } from "../api/client";
import {
  importPlan,
  type PlanImportDay,
  type PlanImportIssue,
  type PlanImportReport,
  type PlanLine,
} from "../api/endpoints";
import { formatDay, formatDuration } from "../app/format";
import { useToast } from "../app/toasts";
import { invalidateTraining } from "../widgets/queries";

const ACTION_LABELS: Record<PlanImportDay["action"], string> = {
  create: "Création",
  replace: "Remplacement",
  unchanged: "Inchangé",
  blocked: "Bloqué (jour réalisé)",
};

function describe(line: PlanLine): string {
  const bits = [
    line.titre,
    line.duree_min === null ? null : formatDuration(line.duree_min),
    line.zone_cible === null ? null : `Z${line.zone_cible}`,
    line.dplus_cible === null ? null : `D+ ${line.dplus_cible} m`,
  ].filter(Boolean);
  return bits.join(", ");
}

function issuesOf(error: unknown): PlanImportIssue[] | null {
  if (error instanceof ApiError && error.detail && typeof error.detail === "object" && "errors" in error.detail) {
    return (error.detail as { errors: PlanImportIssue[] }).errors;
  }
  return null;
}

/** Import d'un plan JSON : dépôt du fichier, aperçu (rien n'est écrit), confirmation. */
export function PlanImportPage() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [doc, setDoc] = useState<unknown>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmPast, setConfirmPast] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<PlanImportReport | null>(null);

  const preview = useMutation({
    mutationFn: (payload: unknown) => importPlan(payload, { dryRun: true }),
    onMutate: () => { setResult(null); },
  });
  const apply = useMutation({
    mutationFn: () => importPlan(doc, { dryRun: false, confirmPastDone: confirmPast }),
    onSuccess: async (report) => {
      setResult(report);
      await invalidateTraining(queryClient);
      notify(`Plan importé : ${report.summary.sessions_added} séance(s) ajoutée(s).`);
    },
  });

  const load = async (file: File) => {
    setLocalError(null);
    setConfirmPast(false);
    setFileName(file.name);
    setDoc(null);
    preview.reset();
    apply.reset();
    setResult(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      setDoc(parsed);
      preview.mutate(parsed);
    } catch {
      setLocalError("Ce fichier n'est pas un JSON valide.");
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void load(file);
  };

  const report = result ?? preview.data ?? null;
  const issues = issuesOf(preview.error) ?? issuesOf(apply.error);
  const otherError = preview.error && !issues ? preview.error.message : apply.error && !issuesOf(apply.error) ? apply.error.message : null;
  const summary = report?.summary;
  const changes = summary ? summary.created_days + summary.replaced_days : 0;

  return (
    <section className="plan-import">
      <div className="toolbar">
        <h1>Importer un plan</h1>
      </div>
      <p className="hint">
        Fichier JSON produit par Claude (voir <code>docs/prompt-plan-claude.md</code>). L'aperçu ne modifie rien ; les jours
        passés déjà réalisés ne sont jamais touchés sans votre confirmation.
      </p>
      <div
        className={`dropzone${dragging ? " dropzone-on" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => { setDragging(false); }}
        onDrop={onDrop}
      >
        <p>Glissez le fichier du plan ici ou</p>
        <button type="button" className="btn" onClick={() => { input.current?.click(); }}>
          Choisir un fichier
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          aria-label="Fichier du plan"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void load(file);
            event.target.value = "";
          }}
        />
        {fileName && <p className="muted">{fileName}</p>}
      </div>

      {localError && <p className="form-error" role="alert">{localError}</p>}
      {preview.isPending && <p role="status">Vérification du plan…</p>}
      {otherError && <p className="form-error" role="alert">{otherError}</p>}
      {issues && (
        <div role="alert" className="import-errors">
          <p>
            <strong>Le plan contient {issues.length} erreur{issues.length > 1 ? "s" : ""} : rien n'a été enregistré.</strong>
          </p>
          <ul>
            {issues.map((issue, i) => (
              <li key={i}>
                {issue.session === null ? "Fichier" : `Séance ${issue.session}`} : {issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {report && summary && (
        <>
          <p role="status">
            {result?.applied
              ? "Plan enregistré. "
              : "Aperçu (rien n'est enregistré). "}
            {summary.sessions_in_file} séance(s) sur {summary.days_in_file} jour(s) : {summary.created_days} création(s),{" "}
            {summary.replaced_days} remplacement(s), {summary.unchanged_days} inchangé(s)
            {summary.blocked_days > 0 && `, ${summary.blocked_days} bloqué(s)`}.
          </p>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Jour</th>
                  <th scope="col">Action</th>
                  <th scope="col">Actuellement</th>
                  <th scope="col">Après l'import</th>
                </tr>
              </thead>
              <tbody>
                {report.days.map((d) => (
                  <tr key={d.date} className={`import-${d.action}`}>
                    <th scope="row">{formatDay(d.date)}</th>
                    <td title={d.reason ?? undefined}>{ACTION_LABELS[d.action]}</td>
                    <td>{d.existing.length ? d.existing.map(describe).join(" + ") : "—"}</td>
                    <td>{d.incoming.map(describe).join(" + ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summary.blocked_days > 0 && !result?.applied && (
            <label className="field">
              <span>
                <input
                  type="checkbox"
                  checked={confirmPast}
                  onChange={(event) => {
                    setConfirmPast(event.target.checked);
                  }}
                />{" "}
                Je confirme la modification des jours passés déjà réalisés ({summary.blocked_days})
              </span>
            </label>
          )}
          {!result?.applied && (
            <div className="entry-row">
              <button
                type="button"
                className="btn btn-primary"
                disabled={apply.isPending || (changes === 0 && !(confirmPast && summary.blocked_days > 0))}
                onClick={() => { apply.mutate(); }}
              >
                Confirmer l'import
              </button>
              {changes === 0 && summary.blocked_days === 0 && <span className="muted">Rien à changer : le plan est déjà à jour.</span>}
            </div>
          )}
        </>
      )}
    </section>
  );
}
