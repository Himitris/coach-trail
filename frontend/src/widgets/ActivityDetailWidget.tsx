import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchActivities, fetchActivity } from "../api/endpoints";
import type { ActivityDetail, ActivityStream, Climb } from "../api/types";
import {
  formatDay,
  formatDuration,
  formatDurationS,
  formatKm,
  formatMeters,
  formatNumber,
  formatPace,
} from "../app/format";
import { ChartBox, EvidenceNote, Stat } from "./common";
import { formatActivityDetail } from "./exports";
import { Overlay } from "./Overlay";
import { sportLabel } from "./labels";
import { registerWidget } from "./registry";
import { WidgetData, WidgetEmpty } from "./states";
import type { WidgetProps } from "./types";

interface DetailSettings extends Record<string, unknown> {
  activityId: number | null;
}

const MAX_PACE_S = 20 * 60; // au-delà : marche à l'arrêt, l'allure n'a plus de sens

interface Sample {
  km: number;
  alt: number | null;
  hr: number | null;
  pace: number | null;
}

export function buildSamples(stream: ActivityStream): Sample[] {
  const samples: Sample[] = [];
  stream.t.forEach((_, i) => {
    const km = stream.distance_km[i];
    if (km === null || km === undefined) return;
    const pace = stream.pace_s_per_km[i] ?? null;
    samples.push({
      km,
      alt: stream.altitude_m[i] ?? null,
      hr: stream.hr[i] ?? null,
      pace: pace !== null && pace <= MAX_PACE_S ? pace : null,
    });
  });
  return samples;
}

const ZONE_NAMES = ["Sous Z1", "Z1", "Z2", "Z3", "Z4", "Z5"];

function ZonesBlock({ detail }: { detail: ActivityDetail }) {
  const zones = detail.zones;
  if (!zones || zones.hr_time_s <= 0) return <p className="muted">Temps par zone indisponible (pas de FC).</p>;
  return (
    <div className="zones" role="table" aria-label="Temps par zone de fréquence cardiaque">
      {zones.seconds.map((s, i) => {
        const share = (s / zones.hr_time_s) * 100;
        const floor = i === 0 ? null : zones.floors_bpm[i - 1];
        const next = zones.floors_bpm[i];
        return (
          <div className="zone-row" role="row" key={ZONE_NAMES[i]}>
            <span role="cell" className="zone-name">
              {ZONE_NAMES[i]}
              {floor !== null && floor !== undefined && (
                <span className="muted"> {floor}{i < 5 && next ? `–${next - 1}` : "+"} bpm</span>
              )}
              {i === 0 && floor === null && next !== undefined && <span className="muted"> &lt;{next} bpm</span>}
            </span>
            <span role="cell" className="zone-bar">
              <span className={`zone-fill zone-${i}`} style={{ width: `${share}%` }} />
            </span>
            <span role="cell" className="zone-time">
              {formatDurationS(s)} · {formatNumber(share)} %
            </span>
          </div>
        );
      })}
      {zones.low_share_pct !== null && (
        <p className="muted zone-summary">
          Bas d'intensité (sous Z1 à Z2) : {formatNumber(zones.low_share_pct)} % du temps avec FC.
        </p>
      )}
    </div>
  );
}

function ClimbsBlock({ climbs, hasProfile }: { climbs: Climb[]; hasProfile: boolean }) {
  if (!hasProfile) return <p className="muted">Découpage par côte indisponible (pas d'altitude).</p>;
  if (climbs.length === 0) return <p className="muted">Aucune côte significative détectée (≥ 50 m de D+, ≥ 3 %).</p>;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Côte</th>
            <th scope="col">Km</th>
            <th scope="col">D+</th>
            <th scope="col">Longueur</th>
            <th scope="col">Pente moy.</th>
            <th scope="col">Durée</th>
            <th scope="col">FC moy.</th>
          </tr>
        </thead>
        <tbody>
          {climbs.map((c, i) => (
            <tr key={c.start_km}>
              <th scope="row">{i + 1}</th>
              <td>
                {formatNumber(c.start_km, 1)}–{formatNumber(c.end_km, 1)}
              </td>
              <td>{formatMeters(c.gain_m)}</td>
              <td>{formatMeters(c.length_m)}</td>
              <td>{formatNumber(c.avg_grade_pct, 1)} %</td>
              <td>{c.duration_s === null ? "—" : formatDurationS(c.duration_s)}</td>
              <td>{c.avg_hr === null ? "—" : formatNumber(c.avg_hr)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProfileCharts({ detail }: { detail: ActivityDetail }) {
  const stream = detail.stream;
  const samples = useMemo(() => (stream ? buildSamples(stream) : []), [stream]);
  if (!stream || samples.length < 2) {
    return <p className="muted">Pas de profil détaillé pour cette sortie.</p>;
  }
  const hasHr = samples.some((s) => s.hr !== null);
  const hasAlt = samples.some((s) => s.alt !== null);
  const hasPace = samples.some((s) => s.pace !== null);
  const maxKm = samples[samples.length - 1]?.km ?? 0;
  return (
    <>
      <h3 className="sub">Profil altimétrique et fréquence cardiaque</h3>
      <ChartBox minHeight={170}>
        {({ width }) => (
          <ComposedChart width={width} height={170} data={samples} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="km" type="number" domain={[0, maxKm]} tickFormatter={(v: number) => formatNumber(v, 0)} unit=" km" tick={{ fontSize: 11 }} />
            {hasAlt && (
              <YAxis yAxisId="alt" tick={{ fontSize: 11 }} width={42} domain={["dataMin - 10", "dataMax + 10"]} tickFormatter={(v: number) => `${Math.round(v)}`} unit=" m" />
            )}
            {hasHr && (
              <YAxis yAxisId="hr" orientation="right" tick={{ fontSize: 11 }} width={36} domain={["dataMin - 5", "dataMax + 5"]} tickFormatter={(v: number) => `${Math.round(v)}`} />
            )}
            <Tooltip
              formatter={(value, name) =>
                name === "alt" ? [`${formatNumber(Number(value))} m`, "Altitude"] : [`${formatNumber(Number(value))} bpm`, "FC"]
              }
              labelFormatter={(v) => `${formatNumber(Number(v), 1)} km`}
            />
            {hasAlt &&
              detail.climbs.map((c) => (
                <ReferenceArea key={c.start_km} yAxisId="alt" x1={c.start_km} x2={c.end_km} fill="var(--accent)" fillOpacity={0.18} />
              ))}
            {hasAlt && <Area yAxisId="alt" type="monotone" dataKey="alt" name="alt" stroke="var(--muted)" fill="var(--surface-2)" isAnimationActive={false} connectNulls />}
            {hasHr && <Line yAxisId="hr" type="monotone" dataKey="hr" name="hr" stroke="var(--danger)" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />}
          </ComposedChart>
        )}
      </ChartBox>
      <h3 className="sub">Allure</h3>
      {hasPace ? (
        <ChartBox minHeight={130}>
          {({ width }) => (
            <LineChart width={width} height={130} data={samples} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="km" type="number" domain={[0, maxKm]} tickFormatter={(v: number) => formatNumber(v, 0)} unit=" km" tick={{ fontSize: 11 }} />
              <YAxis reversed tick={{ fontSize: 11 }} width={52} domain={["dataMin - 15", "dataMax + 15"]} tickFormatter={(v: number) => formatPace(v).replace(" /km", "")} />
              <Tooltip formatter={(value) => [formatPace(Number(value)), "Allure"]} labelFormatter={(v) => `${formatNumber(Number(v), 1)} km`} />
              <Line type="monotone" dataKey="pace" stroke="var(--accent)" dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
            </LineChart>
          )}
        </ChartBox>
      ) : (
        <p className="muted">Allure indisponible (pas de vitesse enregistrée).</p>
      )}
      <p className="muted">
        Allure ajustée à la pente (GAP) : {detail.gap_s_per_km === null ? "non disponible pour l'instant (calcul prévu en phase 2)." : formatPace(detail.gap_s_per_km)}
      </p>
    </>
  );
}

export function ActivityDetailView({ activityId }: { activityId: number }) {
  const query = useQuery({ queryKey: ["activity", activityId], queryFn: () => fetchActivity(activityId) });
  return (
    <WidgetData query={query}>
      {(d) => (
        <div className="detail">
          <h3 className="detail-title">
            {sportLabel(d.sport)} · {formatDay(d.day)}
            {d.is_race && <span className="chip chip-race"> course</span>}
          </h3>
          <div className="stats">
            <Stat label="Durée" value={formatDuration(d.duration_min)} />
            <Stat label="Distance" value={formatKm(d.distance_km)} />
            <Stat label="D+ / D−" value={`${formatMeters(d.dplus_m)} / ${formatMeters(d.dminus_m)}`} />
            <Stat label="Allure moy." value={formatPace(d.pace_s_per_km)} />
            <Stat label="FC moy. / max" value={`${d.hr_avg ?? "—"} / ${d.hr_max ?? "—"}`} />
            <Stat label="RPE" value={d.rpe ?? "—"} />
          </div>
          <ProfileCharts detail={d} />
          <h3 className="sub">Temps par zone</h3>
          <ZonesBlock detail={d} />
          <h3 className="sub">Découpage par côte</h3>
          <ClimbsBlock climbs={d.climbs} hasProfile={d.stream !== null && d.stream.altitude_m.some((a) => a !== null)} />
          {d.notes.length > 0 && (
            <ul className="notes">
              {d.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <EvidenceNote evidence={d.evidence} />
        </div>
      )}
    </WidgetData>
  );
}

/** Détail ouvert depuis « Dernières sorties ». */
export function ActivityDetailDialog({ activityId, onClose }: { activityId: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [onClose]);
  return (
    <Overlay onClose={onClose}>
      <div className="dialog dialog-wide" role="dialog" aria-modal="true" aria-label="Détail de la séance" onClick={(e) => { e.stopPropagation(); }}>
        <div className="dialog-head">
          <h2>Détail de la séance</h2>
          <button type="button" className="btn btn-small" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <ActivityDetailView activityId={activityId} />
      </div>
    </Overlay>
  );
}

export function ActivityDetailWidget({ settings, updateSettings }: WidgetProps<DetailSettings>) {
  const list = useQuery({ queryKey: ["activities", "picker"], queryFn: () => fetchActivities({ limit: 30 }) });
  return (
    <WidgetData query={list} isEmpty={(items) => items.length === 0} emptyMessage="Aucune sortie à afficher.">
      {(items) => {
        const selected = items.find((a) => a.id === settings.activityId);
        const current = selected ?? items[0];
        if (!current) return <WidgetEmpty message="Aucune sortie à afficher." />;
        return (
          <>
            <div className="field detail-picker">
              <label htmlFor="detail-picker">Séance</label>
              <select
                id="detail-picker"
                value={selected ? String(selected.id) : "latest"}
                onChange={(event) => {
                  updateSettings({ activityId: event.target.value === "latest" ? null : Number(event.target.value) });
                }}
              >
                <option value="latest">Dernière sortie</option>
                {items.map((a) => (
                  <option key={a.id} value={a.id}>
                    {formatDay(a.day)} · {sportLabel(a.sport)} · {formatDuration(a.duration_min)}
                  </option>
                ))}
              </select>
            </div>
            <ActivityDetailView activityId={current.id} />
          </>
        );
      }}
    </WidgetData>
  );
}

registerWidget<DetailSettings>({
  id: "activity-detail",
  title: "Détail de séance",
  description: "Profil altimétrique, FC, allure, temps par zone et découpage par côte d'une sortie.",
  defaultSize: { w: 12, h: 11 },
  minSize: { w: 6, h: 6 },
  defaultSettings: { activityId: null },
  settingsSchema: [],
  Component: ActivityDetailWidget,
  exportData: async (settings) => {
    const id = settings.activityId ?? (await fetchActivities({ limit: 1 }))[0]?.id;
    if (id === undefined) return null;
    return { title: "Détail de séance", markdown: formatActivityDetail(await fetchActivity(id)) };
  },
});
