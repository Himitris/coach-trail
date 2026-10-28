import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, Tooltip, XAxis, YAxis, Area } from "recharts";
import { fetchActivities, fetchFitness, fetchGoals } from "../api/endpoints";
import type { FitnessReport, Goal } from "../api/types";
import { addDays, formatDay, formatNumber, formatSigned, todayIso } from "../app/format";
import { ChartBox, EvidenceNote, TrendWord } from "./common";
import { formatFitness } from "./exports";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { periodField } from "./settingFields";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";
import { MiniLine, SummaryLayout } from "./summary";

interface FitnessSettings extends Record<string, unknown> {
  period: string;
}

const PERIODS = [
  { value: "13w", label: "3 mois" },
  { value: "26w", label: "6 mois" },
  { value: "52w", label: "12 mois" },
];

export const daysFor = (period: unknown): number => {
  const weeks = typeof period === "string" ? Number.parseInt(period, 10) : NaN;
  return (Number.isFinite(weeks) && weeks > 0 ? Math.min(weeks, 104) : 26) * 7;
};

/** Jours de course à marquer : objectifs passés ou en cours et courses réalisées, dans la période. */
export function raceDays(goals: Goal[], raceDates: string[], from: string, to: string): { date: string; label: string }[] {
  const days = new Map<string, string>();
  for (const g of goals) if (g.date >= from && g.date <= to) days.set(g.date, g.nom);
  for (const d of raceDates) if (d >= from && d <= to && !days.has(d)) days.set(d, "Course");
  return [...days].map(([date, label]) => ({ date, label })).sort((a, b) => a.date.localeCompare(b.date));
}

export function nextGoal(goals: Goal[], today: string): { goal: Goal; days: number } | null {
  const upcoming = goals.filter((g) => g.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!upcoming) return null;
  const ms = new Date(`${upcoming.date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime();
  return { goal: upcoming, days: Math.round(ms / 86_400_000) };
}

function FitnessView({ report, goals, raceDates, today }: { report: FitnessReport; goals: Goal[]; raceDates: string[]; today: string }) {
  const last = report.points.at(-1);
  const marks = raceDays(goals, raceDates, report.start, report.end);
  const upcoming = nextGoal(goals, today);
  const data = report.points.map((p) => ({ ...p, label: formatDay(p.date) }));
  return (
    <div className="fitness">
      {last && (
        <div className="stats">
          <div className="stat">
            <span className="stat-label">CTL (forme chronique)</span>
            <span className="stat-value">{formatNumber(last.ctl, 1)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">ATL (fatigue aiguë)</span>
            <span className="stat-value">{formatNumber(last.atl, 1)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">TSB (CTL − ATL)</span>
            <span className="stat-value">{formatSigned(last.tsb, 1)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Rampe CTL sur 4 sem.</span>
            <span className="stat-value">{report.ctl_ramp_4w === null ? "—" : formatSigned(report.ctl_ramp_4w, 1)}</span>
            <span className="stat-sub"><TrendWord trend={report.trend} /></span>
          </div>
        </div>
      )}
      <ChartBox minHeight={200}>
        {({ width }) => (
          <ComposedChart width={width} height={200} data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => formatDay(d)} minTickGap={36} />
            <YAxis tick={{ fontSize: 11 }} width={36} />
            <Tooltip
              labelFormatter={(d) => formatDay(String(d))}
              formatter={(value, name) => [formatNumber(Number(value), 1), String(name)]}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="tsb" name="TSB" stroke="none" fill="var(--text)" fillOpacity={0.08} isAnimationActive={false} />
            <Line type="monotone" dataKey="ctl" name="CTL" stroke="var(--accent)" dot={false} strokeWidth={2} isAnimationActive={false} />
            <Line type="monotone" dataKey="atl" name="ATL" stroke="var(--danger)" dot={false} strokeWidth={1.5} strokeDasharray="4 3" isAnimationActive={false} />
            <ReferenceLine y={0} stroke="var(--border)" />
            {marks.map((m) => (
              <ReferenceLine key={m.date} x={m.date} stroke="var(--text)" strokeDasharray="2 3" label={{ value: m.label, position: "top", fontSize: 10, fill: "var(--muted)" }} />
            ))}
          </ComposedChart>
        )}
      </ChartBox>
      {upcoming && (
        <p>
          Prochain objectif : <strong>{upcoming.goal.nom}</strong> le {formatDay(upcoming.goal.date)} —{" "}
          {upcoming.days === 0 ? "aujourd'hui" : `dans ${upcoming.days} jour${upcoming.days > 1 ? "s" : ""}`}.
        </p>
      )}
      {report.reference?.source_ctl != null && (
        <p className="muted">
          Pour comparaison ({report.reference.source}, {formatDay(report.reference.date)}) : CTL{" "}
          {formatNumber(report.reference.source_ctl, 1)}
          {report.reference.source_atl != null && ` · ATL ${formatNumber(report.reference.source_atl, 1)}`}. L'appli
          utilise son propre calcul.
        </p>
      )}
      <p className="muted">Courbes de tendance (constantes 42 j / 7 j), pas un verdict : aucune valeur ne dit « prêt » ou « pas prêt ».</p>
      {report.warnings.length > 0 && (
        <ul className="notes">
          {report.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <EvidenceNote evidence={report.evidence} />
    </div>
  );
}

export function FitnessWidget({ settings }: WidgetProps<FitnessSettings>) {
  const today = todayIso();
  const days = daysFor(settings.period);
  const from = addDays(today, -days);
  const fitness = useQuery({
    queryKey: ["metrics", "fitness", from, today],
    queryFn: () => fetchFitness(from, today),
    refetchInterval: REFRESH_MS,
  });
  const goals = useQuery({ queryKey: ["goals"], queryFn: fetchGoals });
  const races = useQuery({
    queryKey: ["activities", "races", from, today],
    queryFn: () => fetchActivities({ races_only: true, from, to: today, limit: 50 }),
  });
  return (
    <WidgetData
      query={fitness}
      isEmpty={(r) => r.points.length === 0}
      emptyMessage="Aucune séance avec fréquence cardiaque : la courbe de forme ne peut pas être calculée."
    >
      {(report) => (
        <FitnessView report={report} goals={goals.data ?? []} raceDates={(races.data ?? []).map((a) => a.day)} today={today} />
      )}
    </WidgetData>
  );
}

export function FitnessSummary({ settings }: WidgetProps<FitnessSettings>) {
  const today = todayIso();
  const from = addDays(today, -daysFor(settings.period));
  const query = useQuery({
    queryKey: ["metrics", "fitness", from, today],
    queryFn: () => fetchFitness(from, today),
    refetchInterval: REFRESH_MS,
  });
  return (
    <WidgetData query={query} isEmpty={(r) => r.points.length === 0} emptyMessage="Pas encore assez d'historique pour la courbe de forme.">
      {(report) => {
        const last = report.points[report.points.length - 1];
        if (!last) return null;
        return (
          <SummaryLayout
            value={formatNumber(last.ctl, 1)}
            unit="forme (CTL)"
            sub={`Fatigue ${formatNumber(last.atl, 1)} · fraîcheur ${formatSigned(last.tsb, 1)}`}
          >
            <MiniLine data={report.points.map((p) => ({ label: formatDay(p.date), value: p.ctl }))} />
          </SummaryLayout>
        );
      }}
    </WidgetData>
  );
}

registerWidget<FitnessSettings>({
  id: "fitness",
  title: "Forme (CTL / ATL / TSB)",
  description: "Courbes de charge chronique et aiguë, rampe de CTL, jours de course marqués.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  defaultSettings: { period: "26w" },
  settingsSchema: [periodField(PERIODS)],
  Component: FitnessWidget,
  Summary: FitnessSummary,
  exportData: async (settings) => {
    const today = todayIso();
    return {
      title: "Forme (CTL / ATL / TSB)",
      markdown: formatFitness(await fetchFitness(addDays(today, -daysFor(settings.period)), today)),
    };
  },
});
