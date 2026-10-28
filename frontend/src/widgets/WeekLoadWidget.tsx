import { useQuery } from "@tanstack/react-query";
import { fetchWeekMetrics, fetchActivities } from "../api/endpoints";
import type { VolumeTotals, WeekMetrics, Activity } from "../api/types";
import {
  addDays,
  formatDay,
  formatDurationS,
  formatKm,
  formatMeters,
  formatNumber,
  formatSignedPct,
  todayIso,
} from "../app/format";
import { EvidenceNote, TrendWord } from "./common";
import { formatWeekLoad } from "./exports";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";
import { MiniBars, SummaryLayout } from "./summary";

type Getter = (t: VolumeTotals) => string;

const ROWS: { label: string; get: Getter; time?: boolean }[] = [
  { label: "Temps", get: (t) => formatDurationS(t.time_s), time: true },
  { label: "Distance", get: (t) => formatKm(t.distance_m / 1000) },
  { label: "D+", get: (t) => formatMeters(t.gain_m) },
  { label: "D−", get: (t) => formatMeters(t.loss_m) },
  { label: "D+/km", get: (t) => (t.gain_per_km === null ? "—" : `${formatNumber(t.gain_per_km)} m/km`) },
  { label: "Séances", get: (t) => formatNumber(t.sessions, Number.isInteger(t.sessions) ? 0 : 1) },
];

function pct(cur: number, ref: number | undefined): string {
  return ref === undefined || ref === 0 ? "—" : formatSignedPct(((cur - ref) / ref) * 100);
}

const CURRENT_OF: Record<string, (t: VolumeTotals) => number> = {
  Temps: (t) => t.time_s,
  Distance: (t) => t.distance_m,
  "D+": (t) => t.gain_m,
  "D−": (t) => t.loss_m,
};

export function WeekLoad({ week }: { week: WeekMetrics }) {
  const { current, previous, avg_4w: avg } = week;
  const empty = current.sessions === 0;
  return (
    <div className="load">
      <p className="load-title">
        Semaine du {formatDay(week.week_start)} au {formatDay(week.week_end)}
        {!week.complete && <span className="chip chip-upcoming"> en cours</span>}
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col">Cette semaine</th>
              <th scope="col">Semaine préc.</th>
              <th scope="col">Moyenne 4 sem.</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(({ label, get }) => {
              const value = CURRENT_OF[label];
              return (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>
                    <strong>{empty && label !== "Séances" ? "—" : get(current)}</strong>
                  </td>
                  <td>
                    {previous.sessions ? get(previous) : "—"}
                    {value && week.complete && previous.sessions > 0 && !empty && (
                      <span className="delta"> {pct(value(current), value(previous))}</span>
                    )}
                  </td>
                  <td>
                    {avg ? get(avg) : "—"}
                    {value && week.complete && avg && !empty && (
                      <span className="delta"> {pct(value(current), value(avg))}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {week.complete ? (
        <p className="load-rise">
          Temps vs semaine précédente : <strong>{formatSignedPct(week.time_change_vs_previous_pct)}</strong>{" "}
          <TrendWord trend={week.trend} />
          <br />
          <span className="muted">
            Repère de bon sens : environ +{week.reference_rise_pct} % de temps d'une semaine à l'autre. Un ordre
            de grandeur, pas un seuil ni un prédicteur de blessure.
          </span>
        </p>
      ) : (
        <p className="load-rise muted">
          Semaine en cours : la comparaison avec la semaine précédente (repère d'environ +{week.reference_rise_pct}{" "}
          % de temps, simple ordre de grandeur) n'a de sens qu'une fois la semaine terminée. Les valeurs ci-dessus
          sont celles de la semaine jusqu'ici.
        </p>
      )}
      {week.srpe && (
        <p>
          Charge perçue (RPE × minutes) : <strong>{formatNumber(week.srpe.total_load_au)} u.a.</strong>{" "}
          <span className="muted">sur {week.srpe.entries} séance(s) notée(s)</span>
        </p>
      )}
      <EvidenceNote evidence={week.evidence} />
    </div>
  );
}

interface LoadSettings extends Record<string, unknown> {
  week: "current" | "last";
  metric: string;
}

const dateFor = (week: unknown): string | undefined =>
  week === "last" ? addDays(todayIso(), -7) : undefined;

export function WeekLoadWidget({ settings }: WidgetProps<LoadSettings>) {
  const date = dateFor(settings.week);
  const query = useQuery({
    queryKey: ["metrics", "week", date ?? "current"],
    queryFn: () => fetchWeekMetrics(date),
    refetchInterval: REFRESH_MS,
  });
  return (
    <WidgetData
      query={query}
      isEmpty={(w) => w.current.sessions === 0 && w.previous.sessions === 0 && !w.avg_4w}
      emptyMessage="Aucune sortie enregistrée sur les dernières semaines."
    >
      {(week) => <WeekLoad week={week} />}
    </WidgetData>
  );
}

const mondayOf = (iso: string): string => addDays(iso, -((new Date(`${iso}T00:00:00`).getDay() + 6) % 7));

const LOAD_METRICS = {
  km: { label: "km", pick: (a: Activity) => a.distance_km ?? 0, digits: 1 as const },
  dplus: { label: "m de D+", pick: (a: Activity) => a.dplus_m ?? 0, digits: 0 as const },
  temps: { label: "h de course", pick: (a: Activity) => a.duration_min / 60, digits: 1 as const },
};
type LoadMetric = keyof typeof LOAD_METRICS;
const loadMetricOf = (value: unknown): LoadMetric => (value === "dplus" || value === "temps" ? value : "km");

/** Résumé : un seul graphique, la métrique choisie semaine par semaine (8 dernières semaines). */
export function WeekLoadSummary({ settings }: WidgetProps<LoadSettings>) {
  const metric = LOAD_METRICS[loadMetricOf(settings.metric)];
  const today = todayIso();
  const from = addDays(mondayOf(today), -7 * 7);
  const query = useQuery({
    queryKey: ["activities", "weekly", from],
    queryFn: () => fetchActivities({ from, to: today, limit: 500 }),
    refetchInterval: REFRESH_MS,
  });
  return (
    <WidgetData query={query} isEmpty={(items) => items.length === 0} emptyMessage="Aucune sortie enregistrée sur les dernières semaines.">
      {(items) => {
        const weeks = Array.from({ length: 8 }, (_, i) => {
          const start = addDays(from, 7 * i);
          const value = items.filter((a) => mondayOf(a.day) === start).reduce((sum, a) => sum + metric.pick(a), 0);
          return { label: formatDay(start), value };
        });
        const current = weeks[7]?.value ?? 0;
        const previous = weeks[6]?.value ?? 0;
        return (
          <SummaryLayout
            value={formatNumber(current, metric.digits)}
            unit={`${metric.label} cette semaine`}
            sub={`Semaine précédente : ${formatNumber(previous, metric.digits)}`}
          >
            <MiniBars data={weeks} />
          </SummaryLayout>
        );
      }}
    </WidgetData>
  );
}

registerWidget<LoadSettings>({
  id: "week-load",
  title: "Charge de la semaine",
  description: "Temps, distance, D+ et D− vs semaine précédente et moyenne 4 semaines, avec le repère +10 %.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  defaultSettings: { week: "current", metric: "km" },
  settingsSchema: [
    {
      key: "metric",
      label: "Graphique",
      type: "select",
      options: [
        { value: "km", label: "Distance (km)" },
        { value: "dplus", label: "Dénivelé positif" },
        { value: "temps", label: "Temps de course" },
      ],
    },
    {
      key: "week",
      label: "Semaine affichée (détail)",
      type: "select",
      options: [
        { value: "current", label: "Semaine en cours" },
        { value: "last", label: "Dernière semaine terminée" },
      ],
    },
  ],
  Component: WeekLoadWidget,
  Summary: WeekLoadSummary,
  exportData: async (settings) => ({
    title: "Charge de la semaine",
    markdown: formatWeekLoad(await fetchWeekMetrics(dateFor(settings.week))),
  }),
});
