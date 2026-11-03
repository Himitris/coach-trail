import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchActivities, fetchWellness } from "../api/endpoints";
import type { Activity, WellnessPoint } from "../api/types";
import {
  addDays,
  formatDay,
  formatNumber,
  formatPace,
  formatSignedPct,
  todayIso,
} from "../app/format";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";
import { MiniBars, MiniCurve, SummaryLayout } from "./summary";

/**
 * Widget « Métrique libre » : une mesure, une agrégation, une période, un style d'affichage.
 * Les mesures sont des composantes brutes (jamais un score maison) ; ajouter une mesure = une ligne
 * dans MEASURES.
 */

interface Measure {
  label: string;
  unit: string;
  source: "activites" | "bienetre";
  /** Valeur de la mesure pour une ligne de données (null = absente). */
  pick: (row: never) => number | null;
  digits: 0 | 1 | 2;
  /** Une moyenne a du sens, pas une somme (FC, allure, HRV…). */
  averageOnly?: boolean;
  format?: (v: number) => string;
  note?: string;
}

const act = (f: (a: Activity) => number | null) => f as (row: never) => number | null;
const well = (f: (w: WellnessPoint) => number | null) => f as (row: never) => number | null;

export const MEASURES: Record<string, Measure> = {
  km: { label: "Distance", unit: "km", source: "activites", pick: act((a) => a.distance_km), digits: 1 },
  dplus: { label: "Dénivelé positif", unit: "m", source: "activites", pick: act((a) => a.dplus_m), digits: 0 },
  dminus: { label: "Dénivelé négatif", unit: "m", source: "activites", pick: act((a) => a.dminus_m), digits: 0 },
  temps: { label: "Temps de course", unit: "h", source: "activites", pick: act((a) => a.duration_min / 60), digits: 1 },
  seances: { label: "Nombre de séances", unit: "séances", source: "activites", pick: act(() => 1), digits: 0 },
  dplus_km: { label: "D+ par km", unit: "m/km", source: "activites", pick: act((a) => a.dplus_per_km), digits: 0, averageOnly: true },
  fc_moy: { label: "FC moyenne", unit: "bpm", source: "activites", pick: act((a) => a.hr_avg), digits: 0, averageOnly: true },
  allure: {
    label: "Allure",
    unit: "",
    source: "activites",
    pick: act((a) => a.pace_s_per_km),
    digits: 0,
    averageOnly: true,
    format: (v) => formatPace(v),
  },
  calories: { label: "Calories", unit: "kcal", source: "activites", pick: act((a) => a.calories), digits: 0 },
  rpe: { label: "Effort perçu (RPE)", unit: "/10", source: "activites", pick: act((a) => a.rpe), digits: 1, averageOnly: true },
  hrv: { label: "HRV nocturne", unit: "ms", source: "bienetre", pick: well((w) => w.hrv_nuit), digits: 0, averageOnly: true },
  fc_repos: { label: "FC de repos", unit: "bpm", source: "bienetre", pick: well((w) => w.fc_repos), digits: 0, averageOnly: true },
  sommeil: { label: "Durée de sommeil", unit: "h", source: "bienetre", pick: well((w) => w.sommeil_duree_h), digits: 1, averageOnly: true },
  sommeil_eff: { label: "Efficacité du sommeil", unit: "%", source: "bienetre", pick: well((w) => w.sommeil_efficacite), digits: 0, averageOnly: true },
  readiness: {
    label: "Training Readiness",
    unit: "/100",
    source: "bienetre",
    pick: well((w) => w.training_readiness),
    digits: 0,
    averageOnly: true,
    note: "Avis de la montre (indicateur propriétaire Garmin).",
  },
  body_battery: {
    label: "Body Battery (max)",
    unit: "/100",
    source: "bienetre",
    pick: well((w) => w.body_battery_max),
    digits: 0,
    averageOnly: true,
    note: "Avis de la montre (indicateur propriétaire Garmin).",
  },
};

const DEFAULT_MEASURE = "km";
const measureOf = (key: unknown): Measure => MEASURES[typeof key === "string" && key in MEASURES ? key : DEFAULT_MEASURE] as Measure;

type Agg = "sum" | "mean" | "max";
type Bucket = "day" | "week" | "month";
type Style = "bars" | "line" | "value";

const PERIOD_DAYS: Record<string, number> = { "30": 30, "90": 90, "180": 180, "365": 365 };

export interface CustomSettings extends Record<string, unknown> {
  measure: string;
  agg: Agg;
  bucket: Bucket;
  period: string;
  sport: "all" | "run" | "trail" | "other";
  style: Style;
}

const mondayOf = (iso: string): string => addDays(iso, -((new Date(`${iso}T00:00:00`).getDay() + 6) % 7));
const bucketStart = (iso: string, bucket: Bucket): string =>
  bucket === "day" ? iso : bucket === "week" ? mondayOf(iso) : `${iso.slice(0, 7)}-01`;

function nextBucket(iso: string, bucket: Bucket): string {
  if (bucket === "day") return addDays(iso, 1);
  if (bucket === "week") return addDays(iso, 7);
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(y ?? 1970, m ?? 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export interface Bucketed {
  start: string;
  value: number | null;
}

/** Regroupe des lignes datées en seaux (jour / semaine / mois), sans trou entre `from` et `to`. */
export function aggregate(
  rows: { day: string; value: number | null }[],
  from: string,
  to: string,
  bucket: Bucket,
  agg: Agg,
): Bucketed[] {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    if (r.value === null || !Number.isFinite(r.value)) continue;
    const key = bucketStart(r.day, bucket);
    groups.set(key, [...(groups.get(key) ?? []), r.value]);
  }
  const out: Bucketed[] = [];
  for (let s = bucketStart(from, bucket); s <= to; s = nextBucket(s, bucket)) {
    const values = groups.get(s);
    let value: number | null = null;
    if (values && values.length > 0) {
      value =
        agg === "sum" ? values.reduce((a, b) => a + b, 0) : agg === "max" ? Math.max(...values) : values.reduce((a, b) => a + b, 0) / values.length;
    }
    out.push({ start: s, value });
  }
  return out;
}

function labelOf(start: string, bucket: Bucket): string {
  if (bucket === "month") return new Date(`${start}T00:00:00`).toLocaleDateString("fr-FR", { month: "short" });
  return formatDay(start);
}

function useRows(settings: CustomSettings, from: string, to: string) {
  const measure = measureOf(settings.measure);
  const days = Math.max(1, Math.round((new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000));
  const activities = useQuery({
    queryKey: ["custom", "activities", from, settings.sport],
    queryFn: () => fetchActivities({ from, to, limit: 200, group: settings.sport === "all" ? undefined : settings.sport }),
    refetchInterval: REFRESH_MS,
    enabled: measure.source === "activites",
  });
  const wellness = useQuery({
    queryKey: ["custom", "wellness", Math.min(365, days)],
    queryFn: () => fetchWellness(Math.min(365, days)),
    refetchInterval: REFRESH_MS,
    enabled: measure.source === "bienetre",
  });
  const query = (measure.source === "activites" ? activities : wellness) as UseQueryResult<unknown>;
  const rows =
    measure.source === "activites"
      ? (activities.data ?? []).map((a) => ({ day: a.day, value: (measure.pick as (r: Activity) => number | null)(a) }))
      : (wellness.data?.points ?? []).map((w) => ({ day: w.date, value: (measure.pick as (r: WellnessPoint) => number | null)(w) }));
  return { query, rows };
}

function CustomMetric({ settings, detail }: { settings: CustomSettings; detail: boolean }) {
  const measure = measureOf(settings.measure);
  const bucket: Bucket = settings.bucket === "day" || settings.bucket === "month" ? settings.bucket : "week";
  const agg: Agg = measure.averageOnly ? "mean" : settings.agg === "mean" || settings.agg === "max" ? settings.agg : "sum";
  const style: Style = settings.style === "line" || settings.style === "value" ? settings.style : "bars";
  const to = todayIso();
  const from = addDays(to, -(PERIOD_DAYS[settings.period] ?? 90));
  const { query, rows } = useRows(settings, from, to);
  const fmt = (v: number | null): string => (v === null ? "—" : measure.format ? measure.format(v) : formatNumber(v, measure.digits));
  const unit = measure.format ? "" : ` ${measure.unit}`;

  return (
    <WidgetData query={query} isEmpty={() => rows.every((r) => r.value === null)} emptyMessage="Aucune donnée sur cette période.">
      {() => {
        const buckets = aggregate(rows, from, to, bucket, agg);
        const last = buckets[buckets.length - 1];
        const prev = buckets[buckets.length - 2];
        const points = buckets.map((b, i) => ({
          label: labelOf(b.start, bucket),
          title: bucket === "month" ? labelOf(b.start, bucket) : `${bucket === "week" ? "Semaine du " : ""}${formatDay(b.start)}`,
          value: b.value,
          detail: i > 0 && buckets[i - 1]?.value ? [`${formatSignedPct((((b.value ?? 0) - (buckets[i - 1]?.value ?? 0)) / (buckets[i - 1]?.value ?? 1)) * 100)} vs précédent`] : undefined,
        }));
        const numeric = buckets.map((b) => b.value).filter((v): v is number => v !== null);
        const total = numeric.reduce((a, b) => a + b, 0);
        const stats = [
          ...(prev ? [{ label: "Précédent", value: fmt(prev.value) }] : []),
          { label: "Moyenne", value: fmt(numeric.length ? total / numeric.length : null) },
          { label: "Max", value: fmt(numeric.length ? Math.max(...numeric) : null) },
          ...(agg === "sum" ? [{ label: "Total", value: fmt(total) }] : []),
        ];
        const aggLabel = agg === "sum" ? "total" : agg === "max" ? "maximum" : "moyenne";
        const bucketLabel = bucket === "day" ? "du jour" : bucket === "week" ? "de la semaine" : "du mois";
        return (
          <>
            <SummaryLayout
              value={fmt(last?.value ?? null)}
              unit={`${unit.trim()} · ${measure.label} (${aggLabel} ${bucketLabel})`}
              sub={measure.note}
              stats={stats}
            >
              {style === "line" ? (
                <MiniCurve data={points} unit={unit} digits={measure.digits} />
              ) : style === "bars" ? (
                <MiniBars data={points} unit={unit} digits={measure.digits} />
              ) : null}
            </SummaryLayout>
            {detail && (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Période</th>
                      <th scope="col">{measure.label}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...buckets].reverse().map((b) => (
                      <tr key={b.start}>
                        <th scope="row">{labelOf(b.start, bucket)}</th>
                        <td>{fmt(b.value)}{b.value !== null ? unit : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        );
      }}
    </WidgetData>
  );
}

const Summary = ({ settings }: WidgetProps<CustomSettings>) => <CustomMetric settings={settings} detail={false} />;
const Detail = ({ settings }: WidgetProps<CustomSettings>) => <CustomMetric settings={settings} detail />;

const optionsOf = (keys: string[]) => keys.map((k) => ({ value: k, label: `${(MEASURES[k] as Measure).label}${(MEASURES[k] as Measure).unit ? ` (${(MEASURES[k] as Measure).unit})` : ""}` }));

registerWidget<CustomSettings>({
  id: "custom-metric",
  title: "Métrique libre",
  description:
    "Choisis une mesure (distance, D+, FC, allure, HRV, sommeil…), une agrégation, une période et un style (histogramme, courbe, chiffre). Ajoute-le plusieurs fois pour en faire autant de widgets que tu veux.",
  defaultSize: { w: 3, h: 4 },
  minSize: { w: 2, h: 2 },
  defaultSettings: { measure: "km", agg: "sum", bucket: "week", period: "90", sport: "all", style: "bars" },
  settingsSchema: [
    { key: "measure", label: "Mesure", type: "select", options: optionsOf(Object.keys(MEASURES)) },
    {
      key: "agg",
      label: "Agrégation (ignorée pour FC, allure, HRV…)",
      type: "select",
      options: [
        { value: "sum", label: "Total" },
        { value: "mean", label: "Moyenne" },
        { value: "max", label: "Maximum" },
      ],
    },
    {
      key: "bucket",
      label: "Regrouper par",
      type: "select",
      options: [
        { value: "day", label: "Jour" },
        { value: "week", label: "Semaine" },
        { value: "month", label: "Mois" },
      ],
    },
    {
      key: "period",
      label: "Période",
      type: "select",
      options: [
        { value: "30", label: "30 jours" },
        { value: "90", label: "3 mois" },
        { value: "180", label: "6 mois" },
        { value: "365", label: "1 an (bien-être seulement)" },
      ],
    },
    {
      key: "sport",
      label: "Sport (séances)",
      type: "select",
      options: [
        { value: "all", label: "Tous les sports" },
        { value: "run", label: "Course à pied" },
        { value: "trail", label: "Trail" },
        { value: "other", label: "Autres" },
      ],
    },
    {
      key: "style",
      label: "Affichage",
      type: "select",
      options: [
        { value: "bars", label: "Histogramme" },
        { value: "line", label: "Courbe" },
        { value: "value", label: "Chiffre seul" },
      ],
    },
  ],
  Component: Detail,
  Summary,
  exportData: () => null,
});
