import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ReferenceArea, Tooltip, XAxis, YAxis } from "recharts";
import { fetchIntensity } from "../api/endpoints";
import type { IntensityReport, IntensityWeek } from "../api/types";
import { formatDay, formatNumber, formatSigned } from "../app/format";
import { ChartBox, EvidenceNote, TrendWord } from "./common";
import { formatIntensity } from "./exports";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { periodField } from "./settingFields";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";

interface IntensitySettings extends Record<string, unknown> {
  period: string;
}

const PERIODS = [
  { value: "4w", label: "4 semaines" },
  { value: "8w", label: "8 semaines" },
  { value: "12w", label: "12 semaines" },
  { value: "26w", label: "6 mois" },
];

export const weeksFor = (period: unknown): number => {
  const n = typeof period === "string" ? Number.parseInt(period, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 52) : 8;
};

const ZONE_KEYS = ["z1", "z2", "z3", "z4", "z5"] as const;
const ZONE_NAMES = ["Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"];

interface BarRow {
  label: string;
  week: string;
  z1: number;
  z2: number;
  z3: number;
  z4: number;
  z5: number;
  empty: boolean;
}

/** Parts (%) du temps avec FC par zone ; « sous zone 1 » est rangé dans la zone 1. */
export function toBarRows(weeks: IntensityWeek[]): BarRow[] {
  return weeks.map((w) => {
    const hr = w.hr_time_s;
    const part = (s: number) => (hr > 0 ? (s / hr) * 100 : 0);
    const [below = 0, z1 = 0, z2 = 0, z3 = 0, z4 = 0, z5 = 0] = w.zone_seconds;
    return {
      label: formatDay(w.week_start),
      week: w.week_start,
      z1: part(below + z1),
      z2: part(z2),
      z3: part(z3),
      z4: part(z4),
      z5: part(z5),
      empty: hr <= 0,
    };
  });
}

function IntensityChart({ report }: { report: IntensityReport }) {
  const rows = toBarRows(report.weeks);
  return (
    <ChartBox minHeight={190}>
      {({ width }) => (
        <BarChart width={width} height={190} data={rows} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={40} unit=" %" />
          <Tooltip
            formatter={(value, name) => [`${formatNumber(Number(value))} %`, ZONE_NAMES[ZONE_KEYS.indexOf(name as (typeof ZONE_KEYS)[number])] ?? String(name)]}
            labelFormatter={(label) => `Semaine du ${String(label)}`}
          />
          {ZONE_KEYS.map((key, i) => (
            <Bar key={key} dataKey={key} stackId="zones" fill={`var(--zone-${i + 1})`} isAnimationActive={false} />
          ))}
          {/* La fourchette cible (75–80 %) marque la limite haute des zones 1–2 empilées. */}
          <ReferenceArea
            y1={report.target_min_pct}
            y2={report.target_max_pct}
            fill="var(--text)"
            fillOpacity={0.14}
            stroke="var(--text)"
            strokeOpacity={0.5}
            strokeDasharray="4 3"
            ifOverflow="visible"
          />
        </BarChart>
      )}
    </ChartBox>
  );
}

export function IntensitySummary({ report }: { report: IntensityReport }) {
  const withData = report.weeks.filter((w) => w.low_share_pct !== null);
  const last = withData.at(-1);
  const races = report.weeks.reduce((n, w) => n + w.races_excluded, 0);
  return (
    <>
      <ul className="zone-legend" aria-label="Légende des zones">
        {ZONE_NAMES.map((name, i) => (
          <li key={name}>
            <span className="swatch" style={{ background: `var(--zone-${i + 1})` }} /> {name}
          </li>
        ))}
        <li>
          <span className="swatch swatch-target" /> Cible {report.target_min_pct}–{report.target_max_pct} % en zones 1–2
        </li>
      </ul>
      <p>
        Moyenne sur la période :{" "}
        <strong>{report.average_low_share_pct === null ? "—" : `${formatNumber(report.average_low_share_pct)} %`}</strong>{" "}
        en bas d'intensité
        {last?.low_share_pct != null && (
          <>
            {" "}
            · dernière semaine (du {formatDay(last.week_start)}) :{" "}
            <strong>{formatNumber(last.low_share_pct)} %</strong>
            {last.delta_to_target_pct !== null && last.delta_to_target_pct !== 0 && (
              <span className="muted">
                {" "}
                ({formatSigned(last.delta_to_target_pct, 0, "points")} par rapport à la fourchette)
              </span>
            )}
          </>
        )}{" "}
        <TrendWord trend={report.trend} />
      </p>
      {races > 0 && <p className="muted">{races} course(s) exclue(s) : la FC de compétition n'est pas comparée aux séances.</p>}
      <EvidenceNote evidence={report.evidence} />
    </>
  );
}

export function IntensityWidget({ settings }: WidgetProps<IntensitySettings>) {
  const weeks = weeksFor(settings.period);
  const query = useQuery({
    queryKey: ["metrics", "intensity", weeks],
    queryFn: () => fetchIntensity(weeks),
    refetchInterval: REFRESH_MS,
  });
  return (
    <WidgetData
      query={query}
      isEmpty={(r) => r.weeks.every((w) => w.hr_time_s <= 0)}
      emptyMessage="Aucune donnée de fréquence cardiaque sur la période."
    >
      {(report) => (
        <div className="intensity">
          <IntensityChart report={report} />
          <IntensitySummary report={report} />
        </div>
      )}
    </WidgetData>
  );
}

registerWidget<IntensitySettings>({
  id: "intensity",
  title: "Répartition des intensités",
  description: "Temps par zone de FC chaque semaine, avec la cible de 75–80 % en bas d'intensité.",
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 4, h: 5 },
  defaultSettings: { period: "8w" },
  settingsSchema: [periodField(PERIODS)],
  Component: IntensityWidget,
  exportData: async (settings) => ({
    title: "Répartition des intensités",
    markdown: formatIntensity(await fetchIntensity(weeksFor(settings.period))),
  }),
});
