import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { writeClipboard } from "../app/export";
import { useToast } from "../app/toasts";
import { Overlay } from "../widgets/Overlay";
import type { ImportPreview, ImportSpec } from "./types";
import { addDays, mondayOf } from "./week";
import { defaultWeekStart } from "./specs";

const STORAGE_PREFIX = "coach-trail:last-import:";

interface Saved {
  name: string;
  text: string;
}

function loadSaved(widgetId: string): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + widgetId);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(widgetId: string, value: Saved): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + widgetId, JSON.stringify(value));
  } catch {
    // stockage indisponible : le dernier fichier ne sera simplement pas proposé
  }
}

function parseText(spec: ImportSpec, text: string): { doc: unknown; error: string | null } {
  try {
    return { doc: JSON.parse(text), error: null };
  } catch {
    if (spec.plainText && text.trim()) return { doc: text, error: null };
    return { doc: null, error: "Ce contenu n'est pas un JSON valide. Vérifiez que Claude n'a rien ajouté autour du bloc JSON." };
  }
}

export function CopyBlock({ title, hint, text, label, open }: { title: string; hint: string; text: string; label: string; open?: boolean }) {
  const { notify } = useToast();
  return (
    <details className="import-block" open={open}>
      <summary>
        <strong>{title}</strong>
        <span className="muted"> — {hint}</span>
      </summary>
      <pre className="import-pre" tabIndex={0}>{text}</pre>
      <button
        type="button"
        className="btn btn-small"
        onClick={() => {
          void writeClipboard(text).then((ok) => { notify(ok ? `${label} copié.` : "Copie impossible : sélectionnez le texte à la main.", ok ? "info" : "error"); });
        }}
      >
        Copier
      </button>
    </details>
  );
}

/** Fenêtre « Importer » d'un widget : fichier ou texte collé, prompts de format, aperçu, confirmation. */
export function ImportPanel({
  spec,
  widgetTitle,
  updateSettings,
  onClose,
}: {
  spec: ImportSpec;
  widgetTitle: string;
  updateSettings?: (patch: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [weekStart, setWeekStart] = useState(defaultWeekStart);
  const [confirmPast, setConfirmPast] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const saved = useRef(loadSaved(spec.widgetId));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const parsed = text.trim() ? parseText(spec, text) : null;
  const doc = parsed?.doc ?? null;
  const isTemplate = typeof doc === "object" && doc !== null && "semaine_type" in doc;
  const ctx = { queryClient, weekStart, confirmPast, updateSettings };

  // Aperçu automatique (rien n'est écrit) dès que le contenu, la semaine ou la confirmation changent.
  useEffect(() => {
    setPreview(null);
    setFailure(null);
    setDone(null);
    if (!parsed || parsed.error) return;
    let cancelled = false;
    setChecking(true);
    spec
      .preview(parsed.doc, { queryClient, weekStart, confirmPast, updateSettings })
      .then((p) => { if (!cancelled) setPreview(p); })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(error instanceof ApiError || error instanceof Error ? error.message : "La vérification a échoué.");
      })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `parsed` est dérivé de `text`
  }, [text, weekStart, spec, queryClient]);

  const load = async (file: File) => {
    const content = await file.text();
    setFileName(file.name);
    setConfirmPast(false);
    setText(content);
    save(spec.widgetId, { name: file.name, text: content });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void load(file);
  };

  const apply = async () => {
    if (!parsed || parsed.error) return;
    setApplying(true);
    setFailure(null);
    try {
      const message = await spec.apply(parsed.doc, ctx);
      save(spec.widgetId, { name: fileName ?? "Dernier contenu collé", text });
      setDone(message);
      notify(message);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "L'import a échoué.");
    } finally {
      setApplying(false);
    }
  };

  const errors = [...(parsed?.error ? [parsed.error] : []), ...(preview?.errors ?? [])];
  const blocked = preview?.blocked ?? 0;
  const canApply =
    !!preview && errors.length === 0 && !checking && !applying && !done && !preview.nothingToDo && (blocked === 0 || confirmPast || (preview.changes ?? 0) > 0);

  return (
    <Overlay onClose={onClose}>
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-title"
        onClick={(event) => { event.stopPropagation(); }}
      >
        <div className="dialog-head">
          <h2 id="import-title">Importer : {widgetTitle}</h2>
          <button type="button" className="btn btn-small" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <p className="hint">
          {spec.format} L'aperçu ne modifie rien : tout est confirmé par vous avant l'enregistrement.
        </p>

        <section className="import-section">
          <h3>1. Déposer le document</h3>
          <div
            className={`dropzone${dragging ? " dropzone-on" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => { setDragging(false); }}
            onDrop={onDrop}
          >
            <p>Glissez un fichier ici, ou</p>
            <button type="button" className="btn" onClick={() => { fileInput.current?.click(); }}>Choisir un fichier</button>
            {saved.current && !text && (
              <button
                type="button"
                className="btn"
                onClick={() => { if (saved.current) { setFileName(saved.current.name); setText(saved.current.text); } }}
              >
                Reprendre « {saved.current.name} »
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept={spec.plainText ? ".json,.txt,.md,text/*,application/json" : ".json,application/json"}
              className="sr-only"
              aria-label="Fichier à importer"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void load(file);
                event.target.value = "";
              }}
            />
            {fileName && <p className="muted">{fileName}</p>}
          </div>
          <label className="field">
            <span>…ou collez la réponse de Claude</span>
            <textarea
              rows={6}
              value={text}
              spellCheck={false}
              placeholder={spec.plainText ? "Texte de la note" : '{ "version": 1, … }'}
              onChange={(event) => { setText(event.target.value); setFileName(null); setConfirmPast(false); }}
            />
          </label>
        </section>

        {spec.weekTemplate && (isTemplate || !text.trim()) && (
          <section className="import-section">
            <h3>Semaine à remplir</h3>
            <p className="hint">Pour une semaine type, choisissez la semaine : les jours de la semaine sont convertis en dates.</p>
            <div className="entry-row">
              <button type="button" className="btn btn-small" onClick={() => { setWeekStart(addDays(weekStart, -7)); }}>←</button>
              <input
                type="date"
                aria-label="Semaine à remplir"
                value={weekStart}
                onChange={(event) => { if (event.target.value) setWeekStart(mondayOf(event.target.value)); }}
              />
              <button type="button" className="btn btn-small" onClick={() => { setWeekStart(addDays(weekStart, 7)); }}>→</button>
              <span className="muted">du {weekStart} au {addDays(weekStart, 6)}</span>
            </div>
          </section>
        )}

        {checking && <p role="status">Vérification…</p>}
        {failure && <p className="form-error" role="alert">{failure}</p>}
        {errors.length > 0 && (
          <div role="alert" className="import-errors">
            <p><strong>{errors.length} erreur{errors.length > 1 ? "s" : ""} : rien n'a été enregistré.</strong></p>
            <ul>{errors.map((message, i) => <li key={i}>{message}</li>)}</ul>
          </div>
        )}

        {preview && errors.length === 0 && (
          <section className="import-section">
            <h3>Aperçu {done ? "(enregistré)" : "(rien n'est encore enregistré)"}</h3>
            <ul className="import-preview">{preview.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
            {blocked > 0 && !done && (
              <label className="field">
                <span>
                  <input type="checkbox" checked={confirmPast} onChange={(event) => { setConfirmPast(event.target.checked); }} />{" "}
                  Je confirme la modification de {blocked} jour(s) protégé(s) (passés déjà réalisés ou appartenant à un autre plan)
                </span>
              </label>
            )}
            {preview.nothingToDo && <p className="muted">Rien à changer : tout est déjà à jour.</p>}
            {done ? (
              <p role="status"><strong>{done}</strong></p>
            ) : (
              <div className="entry-row">
                <button type="button" className="btn btn-primary" disabled={!canApply} onClick={() => { void apply(); }}>
                  {applying ? "Import…" : "Confirmer l'import"}
                </button>
              </div>
            )}
          </section>
        )}

        <section className="import-section">
          <h3>2. Obtenir le bon format</h3>
          <CopyBlock title="Prompt à coller dans Claude" hint="donne le format exact attendu, avec toutes les règles" text={spec.prompt} label="Prompt" />
          <CopyBlock title="Phrase pour mon coach" hint="à envoyer avec ma semaine type ou mon document" text={spec.coachSentence} label="Phrase" />
          <CopyBlock title="Exemple valide" hint="un fichier qui passe la validation" text={spec.example} label="Exemple" />
          <p className="hint">Toute la documentation des imports est dans la page <Link to="/docs" onClick={onClose}>Documentation</Link>.</p>
        </section>
      </div>
    </Overlay>
  );
}
