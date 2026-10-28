import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { fetchMonotony } from "../api/endpoints";
import type { MonotonyReport } from "../api/types";
import { formatDay, formatNumber } from "../app/format";
import { ChartBox, EvidenceNote, EvidenceBadge } from "./common";
import { formatMonotony } from "./exports";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";
import { MiniLine, SummaryLayout } from "./summary";

interface MonotonySettings extends Record<string, unknown> {
  weeks: string;
}

export const weeksSetting = (value: unknown, fallback: number): number => {
  const n = typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(n) && n >= 2 && n <= 52 ? n : fallback;
};

export function MonotonyView({ report }: { report: MonotonyReport }) {
  const data = report.weeks.map((w) => ({ date: w.week_start, monotony: w.monotony }));
  const alerts = report.weeks.filter((w) => w.soft_alert);
  const last = report.weeks.at(-1);
  return (
    <div className="monotony">
      {last && (
        <div className="stats">
          <div className="stat">
            <span className="stat-label">Monotonie (semaine du {formatDay(last.week_start)})</span>
            <span className="stat-value">{last.monotony === null ? "—" : formatNumber(last.monotony, 2)}</span>
            <span className="stat-sub">repère : {formatNumber(report.reference)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Tension</span>
            <span className="stat-value">{last.strain === null ? "—" : formatNumber(last.strain)}</span>
            <span className="stat-sub">charge × monotonie</span>
          </div>
          <div className="stat">
            <span className="stat-label">Charge de la semaine</span>
            <span className="stat-value">{formatNumber(last.load)}</span>
            <span className="stat-sub">{last.complete ? "semaine terminée" : "en cours"}</span>
          </div>
        </div>
      )}
      {report.weeks.some((w) => w.monotony !== null) ? (
        <ChartBox minHeight={170}>
          {({ width }) => (
            <ComposedChart width={width} height={170} data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => formatDay(d)} minTickGap={30} />
              <YAxis tick={{ fontSize: 11 }} width={32} domain={[0, (max: number) => Math.max(3, Math.ceil(max))]} />
              <Tooltip
                labelFormatter={(d) => `Semaine du ${formatDay(String(d))}`}
                formatter={(value) => [formatNumber(Number(value), 2), "Monotonie"]}
              />
              <ReferenceLine y={report.reference} stroke="var(--muted)" strokeDasharray="5 4" label={{ value: `repère ${formatNumber(report.reference)}`, position: "insideTopRight", fontSize: 10, fill: "var(--muted)" }} />
              <Line type="monotone" dataKey="monotony" stroke="var(--accent)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} connectNulls />
            </ComposedChart>
          )}
        </ChartBox>
      ) : (
        <p className="muted">Pas assez de séances avec charge pour calculer une monotonie.</p>
      )}
      {alerts.length > 0 && (
        <ul className="notes">
          {alerts.map((w) => (
            <li key={w.week_start}>
              Semaine du {formatDay(w.week_start)} : {w.message}
            </li>
          ))}
        </ul>
      )}
      <p className="muted">Information, pas une prédiction : la monotonie ne dit pas qu'une blessure ou une maladie va arriver.</p>
      <EvidenceNote evidence={report.evidence} />
    </div>
  );
}

export function MonotonyWidget({ settings }: WidgetProps<MonotonySettings>) {
  const weeks = weeksSetting(settings.weeks, 12);
  const query = useQuery({ queryKey: ["metrics", "monotony", weeks], queryFn: () => fetchMonotony(weeks), refetchInterval: REFRESH_MS });
  return (
    <WidgetData query={query} isEmpty={(r) => r.weeks.every((w) => w.load === 0)} emptyMessage="Aucune charge d'entraînement sur la période.">
      {(report) => <MonotonyView report={report} />}
    </WidgetData>
  );
}

export function MonotonySummary({ settings }: WidgetProps<MonotonySettings>) {
  const weeks = weeksSetting(settings.weeks, 12);
  const query = useQuery({ queryKey: ["metrics", "monotony", weeks], queryFn: () => fetchMonotony(weeks), refetchInterval: REFRESH_MS });
  return (
    <WidgetData query={query} isEmpty={(r) => r.weeks.every((w) => w.monotony === null)} emptyMessage="Pas encore assez de semaines pour la monotonie.">
      {(report) => {
        const last = report.weeks.filter((w) => w.monotony !== null).at(-1);
        return (
          <SummaryLayout
            value={last?.monotony == null ? "—" : formatNumber(last.monotony, 2)}
            unit="monotonie"
            tag={<EvidenceBadge evidence={report.evidence} />}
            stats={[
              { label: "Repère", value: formatNumber(report.reference) },
              { label: "Tension", value: last?.strain == null ? "—" : formatNumber(last.strain) },
              { label: "Charge", value: formatNumber(last?.load) },
            ]}
          >
            <MiniLine data={report.weeks.map((w) => ({ label: formatDay(w.week_start), value: w.monotony }))} digits={2} />
          </SummaryLayout>
        );
      }}
    </WidgetData>
  );
}

registerWidget<MonotonySettings>({
  id: "monotony",
  title: "Monotonie et tension",
  description: "Monotonie (moyenne ÷ écart-type des charges quotidiennes) et tension par semaine, repère à 2. Information seulement.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  defaultSettings: { weeks: "12" },
  settingsSchema: [
    {
      key: "weeks",
      label: "Période",
      type: "select",
      options: [
        { value: "8", label: "8 semaines" },
        { value: "12", label: "12 semaines" },
        { value: "26", label: "6 mois" },
      ],
    },
  ],
  Component: MonotonyWidget,
  Summary: MonotonySummary,
  exportData: async (settings) => ({ title: "Monotonie et tension", markdown: formatMonotony(await fetchMonotony(weeksSetting(settings.weeks, 12))) }),
});
