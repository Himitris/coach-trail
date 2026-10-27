import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { assignGear, createGear, deleteGear, fetchGear, updateGear } from "../api/endpoints";
import type { GearItem, GearReport, GearStatus } from "../api/types";
import { formatDay, formatKm, formatNumber } from "../app/format";
import { EvidenceNote } from "./common";
import { formatGear } from "./exports";
import { sportLabel } from "./labels";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";

interface GearSettings extends Record<string, unknown> {
  showRetired: boolean;
}

const STATUS_TEXT: Record<GearStatus, string> = {
  ok: "en forme",
  surveiller: "à surveiller",
  atteint: "seuil atteint",
  retire: "retirée",
};

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["gear"] });
}

function GearRow({ item }: { item: GearItem }) {
  const refresh = useRefresh();
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(String(item.seuil_km));
  const [initial, setInitial] = useState(String(item.km_initial));
  const register = useMutation({
    mutationFn: () => createGear({ nom: item.nom, seuil_km: item.seuil_km, km_initial: 0 }),
    onSuccess: refresh,
  });
  const save = useMutation({
    mutationFn: (body: Parameters<typeof updateGear>[1]) => updateGear(item.id ?? 0, body),
    onSuccess: async () => {
      setEditing(false);
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => deleteGear(item.id ?? 0), onSuccess: refresh });
  const pct = Math.min(100, Math.max(0, item.usage_pct));
  const error = register.error ?? save.error ?? remove.error;
  return (
    <li className={`gear gear-${item.status}`} aria-label={`Paire ${item.nom}`}>
      <div className="gear-head">
        <strong>{item.nom}</strong>
        <span className={`chip gear-chip-${item.status}`}>{STATUS_TEXT[item.status]}</span>
      </div>
      <div className="gear-bar" role="progressbar" aria-label={`Usure de ${item.nom}`} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="gear-km">
        <strong>{formatKm(item.km_total)}</strong> sur {formatNumber(item.seuil_km)} km · {item.activities} sortie(s)
        {item.last_used !== null && ` · dernière le ${formatDay(item.last_used)}`}
      </p>
      {item.message && <p className="notice notice-warn" role="note">{item.message}</p>}
      {!item.registered ? (
        <button type="button" className="btn btn-small" disabled={register.isPending} onClick={() => { register.mutate(); }}>
          Enregistrer cette paire (seuil réglable)
        </button>
      ) : (
        <div className="entry-row">
          <button type="button" className="btn btn-small" aria-expanded={editing} onClick={() => { setEditing(!editing); }}>
            Réglages
          </button>
          <button type="button" className="btn btn-small" onClick={() => { save.mutate({ retire: item.status !== "retire" }); }}>
            {item.status === "retire" ? "Remettre en service" : "Retirer"}
          </button>
        </div>
      )}
      {editing && (
        <form
          className="fueling-form"
          aria-label={`Réglages de ${item.nom}`}
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate({ seuil_km: Number(limit), km_initial: Number(initial) });
          }}
        >
          <label className="field">
            <span className="muted">Seuil d'usure (km)</span>
            <input type="number" min={50} max={5000} value={limit} onChange={(event) => { setLimit(event.target.value); }} />
          </label>
          <label className="field">
            <span className="muted">Km déjà parcourus avant l'appli</span>
            <input type="number" min={0} max={20000} value={initial} onChange={(event) => { setInitial(event.target.value); }} />
          </label>
          <div className="entry-row">
            <button type="submit" className="btn btn-primary btn-small" disabled={save.isPending}>
              Enregistrer
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => { if (window.confirm(`Supprimer la paire « ${item.nom} » ? Les sorties restent, sans paire.`)) remove.mutate(); }}
            >
              Supprimer
            </button>
          </div>
        </form>
      )}
      {error && <p className="form-error">{error.message}</p>}
    </li>
  );
}

function AddGear() {
  const refresh = useRefresh();
  const [nom, setNom] = useState("");
  const [limit, setLimit] = useState("800");
  const add = useMutation({
    mutationFn: () => createGear({ nom: nom.trim(), seuil_km: Number(limit), km_initial: 0 }),
    onSuccess: async () => {
      setNom("");
      await refresh();
    },
  });
  return (
    <form
      className="fueling-form"
      aria-label="Ajouter une paire"
      onSubmit={(event) => {
        event.preventDefault();
        if (nom.trim()) add.mutate();
      }}
    >
      <label className="field">
        <span className="muted">Nouvelle paire</span>
        <input type="text" value={nom} placeholder="ex. Speedcross 6" onChange={(event) => { setNom(event.target.value); }} />
      </label>
      <label className="field">
        <span className="muted">Seuil (km)</span>
        <input type="number" min={50} max={5000} value={limit} onChange={(event) => { setLimit(event.target.value); }} />
      </label>
      <button type="submit" className="btn btn-small" disabled={add.isPending || !nom.trim()}>
        Ajouter
      </button>
      {add.isError && <p className="form-error">{add.error.message}</p>}
    </form>
  );
}

function Unassigned({ report }: { report: GearReport }) {
  const refresh = useRefresh();
  const pairs = report.items.filter((i) => i.registered && i.status !== "retire");
  const assign = useMutation({
    mutationFn: ({ activityId, gearId }: { activityId: number; gearId: number }) => assignGear(activityId, gearId),
    onSuccess: refresh,
  });
  if (report.unassigned_total === 0) return null;
  return (
    <>
      <h3 className="sub">Sorties sans paire ({report.unassigned_total})</h3>
      {pairs.length === 0 ? (
        <p className="muted">Enregistrez une paire pour pouvoir y affecter vos sorties.</p>
      ) : (
        <ul className="notes">
          {report.unassigned.map((u) => (
            <li key={u.activity_id}>
              {formatDay(u.day)} · {sportLabel(u.sport)}
              {u.distance_km !== null && ` · ${formatKm(u.distance_km)}`}{" "}
              <select
                aria-label={`Paire pour la sortie du ${formatDay(u.day)}`}
                value=""
                onChange={(event) => { if (event.target.value) assign.mutate({ activityId: u.activity_id, gearId: Number(event.target.value) }); }}
              >
                <option value="">Affecter à…</option>
                {pairs.map((p) => (
                  <option key={p.id} value={p.id ?? ""}>
                    {p.nom}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function GearView({ report, showRetired }: { report: GearReport; showRetired: boolean }) {
  const items = report.items.filter((i) => showRetired || i.status !== "retire");
  return (
    <div className="gear-widget">
      {items.length === 0 ? (
        <p className="muted">Aucune paire détectée ou enregistrée : ajoutez-en une ci-dessous.</p>
      ) : (
        <ul className="gear-list">
          {items.map((item) => (
            <GearRow key={item.nom} item={item} />
          ))}
        </ul>
      )}
      <AddGear />
      <Unassigned report={report} />
      <EvidenceNote evidence={report.evidence} />
    </div>
  );
}

export function GearWidget({ settings }: WidgetProps<GearSettings>) {
  const query = useQuery({ queryKey: ["gear"], queryFn: fetchGear, refetchInterval: REFRESH_MS });
  return <WidgetData query={query}>{(report) => <GearView report={report} showRetired={settings.showRetired} />}</WidgetData>;
}

registerWidget<GearSettings>({
  id: "gear",
  title: "Matériel",
  description: "Kilométrage par paire de chaussures, seuil d'usure réglable et alerte douce, affectation des sorties.",
  defaultSize: { w: 6, h: 9 },
  minSize: { w: 4, h: 6 },
  defaultSettings: { showRetired: false },
  settingsSchema: [{ key: "showRetired", label: "Afficher les paires retirées", type: "boolean" }],
  Component: GearWidget,
  exportData: async () => ({ title: "Matériel", markdown: formatGear(await fetchGear()) }),
});
