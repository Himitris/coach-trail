import { useEffect, useState } from "react";
import { exportJsonUrl, exportStreamsUrl, type ExportPeriod } from "../api/endpoints";
import { Overlay } from "../widgets/Overlay";
import { addDays, todayIso } from "./format";
import { exportActivity, exportPeriod, type ExportResult } from "./export";
import { useToast } from "./toasts";

type Preset = "7d" | "4w" | "12w" | "custom";

const PRESETS: readonly { value: Preset; label: string; days: number }[] = [
  { value: "7d", label: "7 jours", days: 7 },
  { value: "4w", label: "4 semaines", days: 28 },
  { value: "12w", label: "12 semaines", days: 84 },
  { value: "custom", label: "Plage libre", days: 0 },
];

function periodFor(preset: Preset, custom: ExportPeriod): ExportPeriod {
  if (preset === "custom") return custom;
  const days = PRESETS.find((p) => p.value === preset)?.days ?? 28;
  const to = todayIso();
  return { from: addDays(to, 1 - days), to };
}

/** Message de confirmation (ou d'échec) d'un export copié. */
function useResultToast() {
  const { notify } = useToast();
  return (result: ExportResult, what: string) => {
    if (result.ok) notify(`${what} copié pour Claude (${result.chars} caractères).`);
    else if (result.reason === "empty") notify("Rien à exporter.");
    else notify("L'export a échoué.", "error");
  };
}

/** Bouton global de l'en-tête : choix de la période, copie dans le presse-papiers, téléchargements. */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const [preset, setPreset] = useState<Preset>("4w");
  const [custom, setCustom] = useState<ExportPeriod>({ from: addDays(todayIso(), -27), to: todayIso() });
  const [busy, setBusy] = useState(false);
  const report = useResultToast();
  const period = periodFor(preset, custom);
  const invalid = !period.from || !period.to || period.from > period.to;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const copy = () => {
    setBusy(true);
    void exportPeriod(period).then((result) => {
      setBusy(false);
      report(result, "Export");
      if (result.ok) onClose();
    });
  };

  return (
    <Overlay onClose={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-title"
        onClick={(event) => { event.stopPropagation(); }}
      >
        <div className="dialog-head">
          <h2 id="export-title">Copier pour Claude</h2>
          <button type="button" className="btn btn-small" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <p className="export-hint">
          Rien n'est envoyé : le résumé est copié, vous le collez vous-même dans la conversation.
        </p>
        <fieldset className="export-periods">
          <legend>Période</legend>
          {PRESETS.map((p) => (
            <label key={p.value}>
              <input
                type="radio"
                name="export-period"
                value={p.value}
                checked={preset === p.value}
                onChange={() => { setPreset(p.value); }}
              />{" "}
              {p.label}
            </label>
          ))}
        </fieldset>
        {preset === "custom" && (
          <div className="export-range">
            <div className="field">
              <label htmlFor="export-from">Du</label>
              <input
                id="export-from"
                type="date"
                value={custom.from}
                onChange={(event) => { setCustom({ ...custom, from: event.target.value }); }}
              />
            </div>
            <div className="field">
              <label htmlFor="export-to">Au</label>
              <input
                id="export-to"
                type="date"
                value={custom.to}
                onChange={(event) => { setCustom({ ...custom, to: event.target.value }); }}
              />
            </div>
          </div>
        )}
        {invalid && <p className="export-error">La date de début doit précéder la date de fin.</p>}
        <div className="export-actions">
          <button type="button" className="btn btn-primary" disabled={busy || invalid} onClick={copy}>
            {busy ? "Préparation…" : "Copier"}
          </button>
          {!invalid && (
            <>
              <a className="btn" href={exportJsonUrl(period)} download>
                Télécharger le JSON complet
              </a>
              <a className="btn" href={exportStreamsUrl(period)} download>
                Flux de séances (JSON)
              </a>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}

export function ExportButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-small" onClick={() => { setOpen(true); }}>
        Copier pour Claude
      </button>
      {open && <ExportDialog onClose={() => { setOpen(false); }} />}
    </>
  );
}

/** Bouton d'export d'une séance (ligne de tableau ou détail). */
export function ActivityExportButton({ activityId }: { activityId: number }) {
  const report = useResultToast();
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label="Exporter cette séance"
      title="Copier cette séance pour Claude"
      onClick={(event) => {
        event.stopPropagation();
        void exportActivity(activityId).then((result) => { report(result, "Séance"); });
      }}
      onKeyDown={(event) => { event.stopPropagation(); }}
    >
      ⤓
    </button>
  );
}
