import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { fetchFatigue } from "../api/endpoints";
import type { FatigueReport } from "../api/types";
import { formatDay, formatMeters, formatNumber } from "../app/format";
import { ChartBox, EvidenceNote } from "./common";
import { formatFatigue } from "./exports";
import { weeksSetting } from "./MonotonyWidget";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";

interface FatigueSettings extends Record<string, unknown> {
  weeks: string;
}

export function FatigueView({ report, today }: { report: FatigueReport; today: string }) {
  const data = report.weeks.map((w) => ({ date: w.week_start, loss: w.loss_m }));
  return (
    <div className="fatigue">
      {report.suggestion && (
        <p className="notice notice-warn" role="note">
          {report.suggestion.message} Jours faciles : du {formatDay(report.suggestion.easy_from)} au{" "}
          {formatDay(report.suggestion.easy_until)}.
        </p>
      )}
      <h3 className="sub">D− par semaine</h3>
      <ChartBox minHeight={150}>
        {({ width }) => (
          <BarChart width={width} height={150} data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => formatDay(d)} minTickGap={24} />
            <YAxis tick={{ fontSize: 11 }} width={40} />
            <Tooltip labelFormatter={(d) => `Semaine du ${formatDay(String(d))}`} formatter={(v) => [formatMeters(Number(v)), "D−"]} />
            <Bar dataKey="loss" fill="var(--accent)" isAnimationActive={false} />
          </BarChart>
        )}
      </ChartBox>
      <h3 className="sub">Séances à fort D− et courbatures à 48 h</h3>
      {report.strong_sessions.length === 0 ? (
        <p className="muted">Aucune séance à fort D− sur la période (≥ 800 m, ou ≥ 400 m et ≥ 80 m/km).</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Séance</th>
                <th scope="col">D−</th>
                <th scope="col">D−/km</th>
                <th scope="col">Courbatures à 48 h</th>
              </tr>
            </thead>
            <tbody>
              {report.strong_sessions.map((s) => (
                <tr key={s.activity_id}>
                  <th scope="row">{formatDay(s.day)}</th>
                  <td>{formatMeters(s.loss_m)}</td>
                  <td>{s.loss_per_km === null ? "—" : `${formatNumber(s.loss_per_km)} m/km`}</td>
                  <td>
                    {s.soreness !== null
                      ? `${s.soreness}/10`
                      : s.soreness_date > today
                        ? `à saisir le ${formatDay(s.soreness_date)}`
                        : "non saisi"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <EvidenceNote evidence={report.evidence} />
    </div>
  );
}

export function FatigueWidget({ settings }: WidgetProps<FatigueSettings>) {
  const weeks = weeksSetting(settings.weeks, 8);
  const query = useQuery({ queryKey: ["metrics", "fatigue", weeks], queryFn: () => fetchFatigue(weeks), refetchInterval: REFRESH_MS });
  const today = new Date().toLocaleDateString("sv-SE");
  return (
    <WidgetData query={query} isEmpty={(r) => r.weeks.every((w) => w.sessions === 0)} emptyMessage="Aucune sortie sur la période.">
      {(report) => <FatigueView report={report} today={today} />}
    </WidgetData>
  );
}

registerWidget<FatigueSettings>({
  id: "fatigue",
  title: "Fatigue musculaire",
  description: "D− hebdomadaire, séances à fort D− et courbatures saisies 48 h après.",
  defaultSize: { w: 6, h: 8 },
  minSize: { w: 4, h: 6 },
  defaultSettings: { weeks: "8" },
  settingsSchema: [
    {
      key: "weeks",
      label: "Période",
      type: "select",
      options: [
        { value: "4", label: "4 semaines" },
        { value: "8", label: "8 semaines" },
        { value: "12", label: "12 semaines" },
      ],
    },
  ],
  Component: FatigueWidget,
  exportData: async (settings) => ({ title: "Fatigue musculaire", markdown: formatFatigue(await fetchFatigue(weeksSetting(settings.weeks, 8))) }),
});
