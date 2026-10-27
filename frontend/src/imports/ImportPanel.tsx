import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { writeClipboard } from "../app/export";
import { useToast } from "../app/toasts";
import { Overlay } from "../widgets/Overlay";
import { buildGlobalPrompt, GLOBAL_COACH_SENTENCE, GLOBAL_EXAMPLE, splitDocument, type Section } from "./engine";
import type { ImportPreview, ImportSpec } from "./types";
import { addDays, mondayOf } from "./week";
import { defaultWeekStart } from "./specs";

const STORAGE_PREFIX = "coach-trail:last-import:";
const GLOBAL_KEY = "global";

interface Saved {
  name: string;
  text: string;
}

function loadSaved(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: Saved): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // stockage indisponible : le dernier fichier ne sera simplement pas proposé
  }
}

const JSON_ERROR = "Ce contenu n'est pas un JSON valide. Vérifiez que Claude n'a rien ajouté autour du bloc JSON.";

/** Texte → sections à importer. Widget : une seule section (son format). Global : découpage du document. */
function readSections(spec: ImportSpec | undefined, text: string): { sections: Section[]; errors: string[] } {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    if (spec?.plainText && text.trim()) return { sections: [{ spec, doc: text }], errors: [] };
    return { sections: [], errors: [JSON_ERROR] };
  }
  if (spec) return { sections: [{ spec, doc }], errors: [] };
  return splitDocument(doc);
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

interface SectionState {
  preview: ImportPreview | null;
  failure: string | null;
}

/**
 * Moteur d'import commun : fichier ou texte collé → sections → aperçu de chacune (rien n'est écrit)
 * → une confirmation. Avec `spec` : l'import d'un widget ; sans : l'import unique, multi-sections.
 */
function ImportCore({
  spec,
  updateSettings,
  onClose,
}: {
  spec?: ImportSpec;
  updateSettings?: (patch: Record<string, unknown>) => void;
  onClose?: () => void;
}) {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const storageKey = spec?.widgetId ?? GLOBAL_KEY;
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [weekStart, setWeekStart] = useState(defaultWeekStart);
  const [confirmPast, setConfirmPast] = useState(false);
  const [states, setStates] = useState<Record<string, SectionState>>({});
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const saved = useRef(loadSaved(storageKey));

  const { sections, errors: readErrors } = useMemo(
    () => (text.trim() ? readSections(spec, text) : { sections: [] as Section[], errors: [] as string[] }),
    [spec, text],
  );
  const needsWeek = sections.some((s) => typeof s.doc === "object" && s.doc !== null && "semaine_type" in s.doc);
  const weekPicker = spec ? !!spec.weekTemplate && (needsWeek || !text.trim()) : needsWeek;
  const sectionId = (s: Section): string => s.spec.widgetId;

  // Aperçu automatique de chaque section dès que le contenu ou la semaine changent.
  useEffect(() => {
    setStates({});
    setFailure(null);
    setDone(null);
    setExcluded(new Set());
    if (sections.length === 0) return;
    let cancelled = false;
    setChecking(true);
    void Promise.all(
      sections.map(async (s): Promise<[string, SectionState]> => {
        try {
          const preview = await s.spec.preview(s.doc, { queryClient, weekStart, confirmPast: false, updateSettings });
          return [sectionId(s), { preview, failure: null }];
        } catch (error) {
          const message = error instanceof ApiError || error instanceof Error ? error.message : "La vérification a échoué.";
          return [sectionId(s), { preview: null, failure: message }];
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setStates(Object.fromEntries(entries));
      setChecking(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sections` est dérivé de `text`
  }, [sections, weekStart, queryClient]);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const load = async (file: File) => {
    const content = await file.text();
    setFileName(file.name);
    setConfirmPast(false);
    setText(content);
    save(storageKey, { name: file.name, text: content });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void load(file);
  };

  const errorsOf = (s: Section): string[] => states[sectionId(s)]?.preview?.errors ?? [];
  const selected = sections.filter((s) => !excluded.has(sectionId(s)));
  const ready = selected.every((s) => {
    const st = states[sectionId(s)];
    return st !== undefined && st.failure === null && st.preview !== null && st.preview.errors.length === 0;
  });
  const appliable = selected.filter((s) => states[sectionId(s)]?.preview?.nothingToDo !== true);
  const blocked = selected.reduce((n, s) => n + (states[sectionId(s)]?.preview?.blocked ?? 0), 0);
  const changes = selected.reduce((n, s) => n + (states[sectionId(s)]?.preview?.changes ?? 0), 0);
  const canApply =
    readErrors.length === 0 && !checking && !applying && !done && selected.length > 0 && ready && appliable.length > 0 && (blocked === 0 || confirmPast || changes > 0);

  const apply = async () => {
    setApplying(true);
    setFailure(null);
    const messages: string[] = [];
    try {
      for (const s of appliable) {
        messages.push(await s.spec.apply(s.doc, { queryClient, weekStart, confirmPast, updateSettings }));
      }
      save(storageKey, { name: fileName ?? "Dernier contenu collé", text });
      setDone(messages);
      notify(messages.join(" "));
    } catch (error) {
      const message = error instanceof Error ? error.message : "L'import a échoué.";
      setFailure(messages.length ? `${message} (déjà enregistré : ${messages.join(" ")})` : message);
    } finally {
      setApplying(false);
    }
  };

  const multi = !spec;
  const sectionFailures = sections.flatMap((s) => (states[sectionId(s)]?.failure ? [states[sectionId(s)]?.failure ?? ""] : []));
  const parseErrors = readErrors;

  return (
    <>
      <p className="hint">
        {spec
          ? spec.format
          : "Collez la réponse de Claude : plan, courses, saisies, matériel, dans un seul fichier. Chaque partie est vérifiée séparément."}{" "}
        L'aperçu ne modifie rien : tout est confirmé par vous avant l'enregistrement.
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
            accept={spec?.plainText ? ".json,.txt,.md,text/*,application/json" : ".json,application/json"}
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
            placeholder={spec?.plainText ? "Texte de la note" : '{ "version": 2, … }'}
            onChange={(event) => { setText(event.target.value); setFileName(null); setConfirmPast(false); }}
          />
        </label>
      </section>

      {weekPicker && (
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
      {sectionFailures.map((message) => <p key={message} className="form-error" role="alert">{message}</p>)}
      {parseErrors.length > 0 && (
        <div role="alert" className="import-errors">
          <p><strong>{parseErrors.length} erreur{parseErrors.length > 1 ? "s" : ""} : rien n'a été enregistré.</strong></p>
          <ul>{parseErrors.map((message, i) => <li key={i}>{message}</li>)}</ul>
        </div>
      )}

      {sections.map((s) => {
        const id = sectionId(s);
        const st = states[id];
        const errs = errorsOf(s);
        const isOff = excluded.has(id);
        return (
          <section key={id} className="import-section" aria-label={multi ? s.spec.label : undefined}>
            {multi ? (
              <label className="import-section-head">
                <input
                  type="checkbox"
                  checked={!isOff}
                  disabled={!!done}
                  aria-label={`Importer : ${s.spec.label}`}
                  onChange={() => {
                    const next = new Set(excluded);
                    if (isOff) next.delete(id); else next.add(id);
                    setExcluded(next);
                  }}
                />{" "}
                <strong>{s.spec.label}</strong>
              </label>
            ) : null}
            {errs.length > 0 && (
              <div role="alert" className="import-errors">
                <p><strong>{errs.length} erreur{errs.length > 1 ? "s" : ""}{multi ? "" : " : rien n'a été enregistré"}.</strong></p>
                <ul>{errs.map((message, i) => <li key={i}>{message}</li>)}</ul>
              </div>
            )}
            {st?.preview && errs.length === 0 && !isOff && (
              <>
                {!multi && <h3>Aperçu {done ? "(enregistré)" : "(rien n'est encore enregistré)"}</h3>}
                {(st.preview.notes ?? []).map((note) => <p key={note} className="plan-target">{note}</p>)}
                <ul className="import-preview">{st.preview.lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
                {st.preview.nothingToDo && <p className="muted">Rien à changer : tout est déjà à jour.</p>}
              </>
            )}
          </section>
        );
      })}

      {sections.length > 0 && parseErrors.length === 0 && (
        <section className="import-section">
          {multi && <h3>Aperçu {done ? "(enregistré)" : "(rien n'est encore enregistré)"}</h3>}
          {blocked > 0 && !done && (
            <label className="field">
              <span>
                <input type="checkbox" checked={confirmPast} onChange={(event) => { setConfirmPast(event.target.checked); }} />{" "}
                Je confirme la modification de {blocked} jour(s) protégé(s) (passés déjà réalisés ou appartenant à un autre plan)
              </span>
            </label>
          )}
          {done ? (
            <p role="status"><strong>{done.join(" ")}</strong></p>
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
        {spec ? (
          <>
            <CopyBlock title="Prompt à coller dans Claude" hint="donne le format exact attendu, avec toutes les règles" text={spec.prompt} label="Prompt" />
            <CopyBlock title="Phrase pour mon coach" hint="à envoyer avec ma semaine type ou mon document" text={spec.coachSentence} label="Phrase" />
            <CopyBlock title="Exemple valide" hint="un fichier qui passe la validation" text={spec.example} label="Exemple" />
          </>
        ) : (
          <>
            <CopyBlock open title="Prompt unique à donner à Claude" hint="un seul format pour le plan, les courses, les saisies et le matériel" text={buildGlobalPrompt()} label="Prompt" />
            <CopyBlock title="Phrase pour mon coach" hint="à envoyer avec le document source" text={GLOBAL_COACH_SENTENCE} label="Phrase" />
            <CopyBlock title="Exemple valide" hint="un fichier qui passe la validation" text={GLOBAL_EXAMPLE} label="Exemple" />
          </>
        )}
        <p className="hint">Toute la documentation des imports est dans la page <Link to="/docs" onClick={onClose}>Documentation</Link>.</p>
      </section>
    </>
  );
}

/** Fenêtre « Importer » d'un widget : même moteur que l'import unique, limité à son format. */
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
        <ImportCore spec={spec} updateSettings={updateSettings} onClose={onClose} />
      </div>
    </Overlay>
  );
}

/** Page « Importer » : un seul point d'entrée pour tout ce que le coach produit. */
export function ImportPage() {
  return (
    <section className="import-page">
      <div className="toolbar">
        <h1>Importer</h1>
      </div>
      <ImportCore />
    </section>
  );
}
