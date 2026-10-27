import { useQuery } from "@tanstack/react-query";
import { fetchWeekMetrics } from "../api/endpoints";
import type { VolumeTotals, WeekMetrics } from "../api/types";
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

registerWidget<LoadSettings>({
  id: "week-load",
  title: "Charge de la semaine",
  description: "Temps, distance, D+ et D− vs semaine précédente et moyenne 4 semaines, avec le repère +10 %.",
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 4, h: 4 },
  defaultSettings: { week: "current" },
  settingsSchema: [
    {
      key: "week",
      label: "Semaine affichée",
      type: "select",
      options: [
        { value: "current", label: "Semaine en cours" },
        { value: "last", label: "Dernière semaine terminée" },
      ],
    },
  ],
  Component: WeekLoadWidget,
  exportData: async (settings) => ({
    title: "Charge de la semaine",
    markdown: formatWeekLoad(await fetchWeekMetrics(dateFor(settings.week))),
  }),
});
