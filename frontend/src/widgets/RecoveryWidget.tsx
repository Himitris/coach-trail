import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { fetchRecovery, fetchWellness } from "../api/endpoints";
import type { BaselineComparison, ProprietaryMetric, RecoveryMetrics, WellnessPoint } from "../api/types";
import { addDays, formatDay, formatNumber, formatSigned, formatSignedPct } from "../app/format";
import { ChartBox, EvidenceBadge, EvidenceNote, TrendWord } from "./common";
import { formatRecovery } from "./exports";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";

interface RecoverySettings extends Record<string, unknown> {
  window: string;
  baseline: string;
}

const WINDOWS = [
  { value: "28", label: "4 semaines" },
  { value: "60", label: "60 jours" },
];
const BASELINES = [
  { value: "30", label: "30 jours" },
  { value: "45", label: "45 jours" },
  { value: "60", label: "60 jours" },
];

const toInt = (value: unknown, fallback: number, lo: number, hi: number): number => {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** Moyenne glissante sur `windowDays` jours calendaires ; null s'il y a moins de `minValues` valeurs. */
export function rollingMean(
  points: { date: string; value: number | null }[],
  windowDays = 7,
  minValues = 3,
): (number | null)[] {
  return points.map((p) => {
    const from = addDays(p.date, -(windowDays - 1));
    const values = points
      .filter((q) => q.date >= from && q.date <= p.date && q.value !== null)
      .map((q) => q.value as number);
    return values.length >= minValues ? values.reduce((a, b) => a + b, 0) / values.length : null;
  });
}

function BaselineCard({
  title,
  unit,
  c,
  digits = 0,
}: {
  title: string;
  unit: string;
  c: BaselineComparison;
  digits?: 0 | 1;
}) {
  const none = c.recent_mean === null;
  return (
    <div className="stat stat-card">
      <span className="stat-label">{title} · moyenne 7 j</span>
      <span className="stat-value">{none ? "—" : `${formatNumber(c.recent_mean, digits)} ${unit}`}</span>
      {c.baseline_mean !== null && (
        <span className="stat-sub">
          base {c.baseline_days} j : {formatNumber(c.baseline_mean, digits)}
          {c.baseline_sd !== null && ` ± ${formatNumber(c.baseline_sd, digits === 0 ? 1 : digits)}`} {unit}
        </span>
      )}
      {c.sufficient ? (
        <span className="stat-sub">
          {formatSignedPct(c.delta_pct, 1)}
          {c.delta_sd !== null && ` · ${formatSigned(c.delta_sd, 1)} écart-type`} <TrendWord trend={c.trend} />
        </span>
      ) : (
        <span className="stat-sub muted" title={c.evidence.summary}>
          Données insuffisantes pour une tendance ({c.recent_n} nuits récentes, {c.baseline_n} jours de base).
        </span>
      )}
    </div>
  );
}

function ProprietaryCard({ title, m, suffix = "" }: { title: string; m: ProprietaryMetric; suffix?: string }) {
  return (
    <div className="stat stat-card stat-proprietary">
      <span className="stat-label">{title}</span>
      <span className="stat-value">{m.value === null ? "—" : `${formatNumber(m.value)}${suffix}`}</span>
      <span className="stat-sub">
        <EvidenceBadge evidence={m.evidence} label={m.label} />
        {m.date && <span className="muted"> {formatDay(m.date)}</span>}
      </span>
    </div>
  );
}

function HrvChart({ points, recovery }: { points: WellnessPoint[]; recovery: RecoveryMetrics }) {
  const values = points.map((p) => ({ date: p.date, value: p.hrv_nuit }));
  const avg = rollingMean(values);
  const data = points.map((p, i) => ({ date: p.date, hrv: p.hrv_nuit, avg7: avg[i] ?? null }));
  const ref = recovery.garmin_hrv_reference;
  if (!points.some((p) => p.hrv_nuit !== null)) return <p className="muted">Pas de HRV nocturne sur la période.</p>;
  return (
    <>
      <h3 className="sub">HRV nocturne</h3>
      <ChartBox minHeight={170}>
        {({ width }) => (
          <ComposedChart width={width} height={170} data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => formatDay(d)} minTickGap={30} />
            <YAxis tick={{ fontSize: 11 }} width={36} domain={["dataMin - 5", "dataMax + 5"]} tickFormatter={(v: number) => String(Math.round(v))} />
            <Tooltip
              labelFormatter={(d) => formatDay(String(d))}
              formatter={(value, name) => [`${formatNumber(Number(value), 1)} ms`, name === "hrv" ? "Nuit" : "Moyenne 7 j"]}
            />
            {ref && (
              <ReferenceArea y1={ref.min} y2={ref.max} fill="var(--accent)" fillOpacity={0.12} stroke="none" ifOverflow="extendDomain" />
            )}
            {recovery.hrv.baseline_mean !== null && (
              <ReferenceLine y={recovery.hrv.baseline_mean} stroke="var(--muted)" strokeDasharray="5 4" />
            )}
            <Line type="monotone" dataKey="hrv" stroke="var(--muted)" strokeWidth={1} dot={{ r: 2 }} isAnimationActive={false} connectNulls={false} />
            <Line type="monotone" dataKey="avg7" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          </ComposedChart>
        )}
      </ChartBox>
      <p className="muted chart-legend">
        Points : valeur de chaque nuit · ligne : moyenne 7 j · tirets : base {recovery.baseline_days} j (moyenne)
        {ref && (
          <>
            {" "}
            · bande : plage de référence Garmin ({formatNumber(ref.min)}–{formatNumber(ref.max)} ms,{" "}
            <EvidenceBadge evidence={{ level: "avis_montre", summary: ref.label }} />)
          </>
        )}
      </p>
    </>
  );
}

export function RecoveryView({ recovery, points }: { recovery: RecoveryMetrics; points: WellnessPoint[] }) {
  return (
    <div className="recovery">
      <div className="stats">
        <BaselineCard title="HRV" unit="ms" c={recovery.hrv} />
        <BaselineCard title="FC repos" unit="bpm" c={recovery.resting_hr} />
        <BaselineCard title="Sommeil (durée)" unit="h" c={recovery.sleep_duration_h} digits={1} />
        <BaselineCard title="Sommeil (efficacité estimée)" unit="%" c={recovery.sleep_efficiency_pct} />
      </div>
      <HrvChart points={points} recovery={recovery} />
      {recovery.fallback && (
        <p className="notice notice-warn" role="note">
          Garmin indisponible depuis le {formatDay(recovery.fallback.since)} : valeurs de repli Intervals.icu.{" "}
          {recovery.fallback.message}
        </p>
      )}
      <h3 className="sub">Avis de la montre</h3>
      <div className="stats">
        <ProprietaryCard title="Training Readiness" m={recovery.training_readiness} />
        <ProprietaryCard title="Body Battery (max)" m={recovery.body_battery_max} />
        <ProprietaryCard title="Body Battery (min)" m={recovery.body_battery_min} />
        {recovery.acwr && (
          <div className="stat stat-card stat-proprietary stat-grey">
            <span className="stat-label">ACWR (Garmin)</span>
            <span className="stat-value">{formatNumber(recovery.acwr.value, 2)}</span>
            <span className="stat-sub">
              <EvidenceBadge evidence={recovery.acwr.evidence} label={recovery.acwr.label} />
            </span>
          </div>
        )}
      </div>
      <p className="muted">
        Tendances face à votre base individuelle : aucun seuil quotidien, pas de feu vert ni de feu rouge — une
        nuit isolée ne dit rien.
      </p>
      <EvidenceNote evidence={recovery.hrv.evidence} />
    </div>
  );
}

export function RecoveryWidget({ settings }: WidgetProps<RecoverySettings>) {
  const window = toInt(settings.window, 28, 7, 90);
  const baseline = toInt(settings.baseline, 60, 30, 60);
  const recovery = useQuery({
    queryKey: ["metrics", "recovery", baseline],
    queryFn: () => fetchRecovery(baseline),
    refetchInterval: REFRESH_MS,
  });
  const wellness = useQuery({
    queryKey: ["metrics", "wellness", window],
    queryFn: () => fetchWellness(window),
    refetchInterval: REFRESH_MS,
  });
  return (
    <WidgetData
      query={wellness}
      isEmpty={(w) => w.points.length === 0}
      emptyMessage="Aucune donnée de récupération reçue (montre non synchronisée ?)."
    >
      {(series) => (
        <WidgetData query={recovery}>{(rec) => <RecoveryView recovery={rec} points={series.points} />}</WidgetData>
      )}
    </WidgetData>
  );
}

registerWidget<RecoverySettings>({
  id: "recovery",
  title: "Récupération",
  description: "HRV, FC repos et sommeil sur 7 jours face à votre base ; avis Garmin étiquetés, sans feu vert/rouge.",
  defaultSize: { w: 6, h: 9 },
  minSize: { w: 4, h: 6 },
  defaultSettings: { window: "28", baseline: "60" },
  settingsSchema: [
    { key: "window", label: "Courbe HRV sur", type: "select", options: WINDOWS },
    { key: "baseline", label: "Base de comparaison", type: "select", options: BASELINES },
  ],
  Component: RecoveryWidget,
  exportData: async (settings) => ({
    title: "Récupération",
    markdown: formatRecovery(await fetchRecovery(toInt(settings.baseline, 60, 30, 60))),
  }),
});
