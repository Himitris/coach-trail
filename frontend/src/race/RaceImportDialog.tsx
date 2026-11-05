import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { putRacePlan } from "../api/endpoints";
import type { Goal } from "../api/types";
import { writeClipboard } from "../app/export";
import { useToast } from "../app/toasts";
import { CopyBlock } from "../imports/ImportPanel";
import { Overlay } from "../widgets/Overlay";
import { RACE_EXAMPLE, racePrompt } from "./logic";
import type { RacePlanDoc } from "./types";

function errorsOf(error: unknown): string[] {
  if (error instanceof ApiError && Array.isArray(error.detail)) {
    return (error.detail as { loc?: unknown[]; msg?: string }[]).map((d) => {
      const where = (d.loc ?? []).filter((p) => p !== "body").join(" › ");
      return where ? `${where} : ${d.msg ?? "invalide"}` : (d.msg ?? "invalide");
    });
  }
  return [error instanceof Error ? error.message : "La vérification a échoué."];
}

function summary(doc: RacePlanDoc): string[] {
  const lines: string[] = [];
  if (doc.objectif) lines.push("Objectif de temps / stratégie");
  if (doc.jours_avant?.length) lines.push(`${doc.jours_avant.length} jour(s) avant la course`);
  if (doc.matin) lines.push("Matin de course");
  if (doc.tranches?.length) lines.push(`${doc.tranches.length} tranche(s) de course`);
  if (doc.ravitaillements?.length) lines.push(`${doc.ravitaillements.length} ravitaillement(s)`);
  if (doc.materiel?.length) lines.push(`${doc.materiel.length} élément(s) de matériel`);
  if (doc.apres_course) lines.push("Après la course");
  if (doc.notes?.length) lines.push(`${doc.notes.length} note(s)`);
  return lines;
}

/** Import du plan du jour J : prompt à donner à Claude, collage ou fichier, vérification, remplacement. */
export function RaceImportDialog({ goal, hasPlan, onClose }: { goal: Goal; hasPlan: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [lines, setLines] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setErrors([]);
    setLines([]);
    setWarnings([]);
    if (!text.trim()) return;
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      setErrors(["Ce contenu n'est pas un JSON valide. Vérifiez que Claude n'a rien ajouté autour du bloc JSON."]);
      return;
    }
    let cancelled = false;
    putRacePlan(goal.id, doc, true).then(
      (out) => {
        if (cancelled) return;
        setLines(summary(out.data));
        setWarnings(out.warnings);
      },
      (error: unknown) => {
        if (!cancelled) setErrors(errorsOf(error));
      },
    );
    return () => { cancelled = true; };
  }, [text, goal.id]);

  const apply = async () => {
    setBusy(true);
    try {
      await putRacePlan(goal.id, JSON.parse(text));
      await queryClient.invalidateQueries({ queryKey: ["race-plan", goal.id] });
      notify("Plan de course enregistré.");
      onClose();
    } catch (error) {
      setErrors(errorsOf(error));
    } finally {
      setBusy(false);
    }
  };

  const prompt = racePrompt(goal.nom, goal.date, goal.distance_km, goal.dplus_m);
  return (
    <Overlay onClose={onClose}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="race-import-title" onClick={(e) => { e.stopPropagation(); }}>
        <div className="dialog-head">
          <h2 id="race-import-title">Importer le plan de course : {goal.nom}</h2>
          <button type="button" className="btn btn-small" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <CopyBlock title="Prompt pour Claude" hint="à coller dans Claude, avec vos infos de course" text={prompt} label="Prompt" open />
        <CopyBlock title="Exemple valide" hint="un fichier qui passe la validation" text={RACE_EXAMPLE} label="Exemple" />
        <label className="field">
          <span>Réponse de Claude (JSON)</span>
          <textarea rows={8} value={text} onChange={(e) => { setText(e.target.value); }} spellCheck={false} placeholder="Collez le JSON ici" />
        </label>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json,text/plain"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void file.text().then(setText);
            e.target.value = "";
          }}
        />
        <div className="toolbar-actions">
          <button type="button" className="btn" onClick={() => { fileInput.current?.click(); }}>Choisir un fichier…</button>
          <button type="button" className="btn" onClick={() => { void writeClipboard(prompt).then((ok) => { notify(ok ? "Prompt copié." : "Copie impossible.", ok ? "info" : "error"); }); }}>
            Copier le prompt
          </button>
        </div>
        {errors.length > 0 && (
          <ul className="form-error" role="alert">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}
        {lines.length > 0 && errors.length === 0 && (
          <div role="status">
            <p><strong>{hasPlan ? "Remplacera entièrement le plan actuel de cette course :" : "Sera enregistré :"}</strong></p>
            <ul className="notes">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
            {warnings.map((w) => <p key={w} className="muted">⚠ {w}</p>)}
          </div>
        )}
        <div className="toolbar-actions">
          <button type="button" className="btn btn-primary" disabled={busy || lines.length === 0 || errors.length > 0} onClick={() => { void apply(); }}>
            {hasPlan ? "Remplacer le plan" : "Enregistrer le plan"}
          </button>
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
        </div>
      </div>
    </Overlay>
  );
}
