import { useEffect, useState } from "react";
import {
  CSV_SERIES,
  EXPORT_FORMATS,
  exportStreamsUrl,
  exportUrl,
  widgetExportUrl,
  type ExportFormat,
  type ExportPeriod,
} from "../api/endpoints";
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
    else if (result.reason === "clipboard")
      notify("Copie impossible (presse-papiers bloqué) : utilisez « Télécharger ».", "error");
    else notify("L'export a échoué.", "error");
  };
}

/** Bouton global de l'en-tête : choix de la période, copie dans le presse-papiers, téléchargements. */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const [preset, setPreset] = useState<Preset>("4w");
  const [custom, setCustom] = useState<ExportPeriod>({ from: addDays(todayIso(), -27), to: todayIso() });
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("md");
  const [series, setSeries] = useState("activities");
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
    void exportPeriod(period, format, series).then((result) => {
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
        <fieldset className="export-periods">
          <legend>Format</legend>
          {EXPORT_FORMATS.map((f) => (
            <label key={f.value}>
              <input
                type="radio"
                name="export-format"
                value={f.value}
                checked={format === f.value}
                onChange={() => { setFormat(f.value); }}
              />{" "}
              {f.label}
            </label>
          ))}
        </fieldset>
        {format === "csv" && (
          <div className="field">
            <label htmlFor="export-series">Série</label>
            <select id="export-series" value={series} onChange={(event) => { setSeries(event.target.value); }}>
              {CSV_SERIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        )}
        {invalid && <p className="export-error">La date de début doit précéder la date de fin.</p>}
        <div className="export-actions">
          <button type="button" className="btn btn-primary" disabled={busy || invalid} onClick={copy}>
            {busy ? "Préparation…" : "Copier"}
          </button>
          {!invalid && (
            <>
              <a className="btn" href={exportUrl(period, format, series)} download>
                {format === "json" ? "Télécharger le JSON complet" : `Télécharger (${format === "csv" ? "CSV" : "Markdown"})`}
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

/** Menu de format d'un widget : Markdown copié, JSON ou CSV téléchargés (série du widget). */
export function WidgetExportMenu({ widgetId, title }: { widgetId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const { notify } = useToast();
  const download = (format: ExportFormat) => {
    setOpen(false);
    void fetch(widgetExportUrl(widgetId, format))
      .then(async (response) => {
        if (!response.ok) {
          const detail = (await response.json().catch(() => null)) as { detail?: unknown } | null;
          notify(typeof detail?.detail === "string" ? detail.detail : "L'export a échoué.", "error");
          return;
        }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement("a");
        link.href = url;
        link.download = `${widgetId}.${format}`;
        link.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => { notify("L'export a échoué.", "error"); });
  };
  return (
    <span className="export-menu">
      <button
        type="button"
        className="icon-btn"
        aria-label={`Autres formats : ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { setOpen(!open); }}
      >
        ▾
      </button>
      {open && (
        <div role="menu" className="menu export-menu-list">
          <button type="button" role="menuitem" onClick={() => { download("json"); }}>
            Télécharger en JSON
          </button>
          <button type="button" role="menuitem" onClick={() => { download("csv"); }}>
            Télécharger en CSV
          </button>
        </div>
      )}
    </span>
  );
}
