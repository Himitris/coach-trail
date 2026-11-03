import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, Tooltip, XAxis, YAxis } from "recharts";
import { fetchStravaSegments, type SegmentEffort, type StravaSegments } from "../api/endpoints";
import { formatDay, formatDurationS, formatNumber, todayIso } from "../app/format";
import { ChartBox } from "./common";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";
import { SummaryLayout } from "./summary";

type Kind = "all" | "kom" | "pr";

interface SegmentSettings extends Record<string, unknown> {
  period: string;
  kind: Kind;
}

const PERIODS: Record<string, number> = { "90": 90, "365": 365, "730": 730 };
const daysOf = (period: unknown): number => PERIODS[String(period)] ?? 365;
const kindOf = (kind: unknown): Kind => (kind === "kom" || kind === "pr" ? kind : "all");

const GOLD = "#c9a227";
const SILVER = "#9aa0a6";
const BRONZE = "#b0763c";

/** « KOM / QOM », « Top 10 · 4e », « Record perso » : le rang tel que Strava l'a donné à l'envoi. */
export function rankLabels(e: Pick<SegmentEffort, "kom_rank" | "pr_rank">): string[] {
  const out: string[] = [];
  if (e.kom_rank === 1) out.push("KOM / QOM");
  else if (e.kom_rank !== null) out.push(`Top 10 · ${e.kom_rank}e`);
  if (e.pr_rank === 1) out.push("Record perso");
  else if (e.pr_rank !== null) out.push(`Perso · ${e.pr_rank}e`);
  return out;
}

const keep = (kind: Kind) => (e: SegmentEffort) =>
  kind === "kom" ? e.kom_rank !== null : kind === "pr" ? e.pr_rank !== null : true;

/** Page du segment (classement, KOM) sur Strava. */
export const segmentUrl = (segmentId: number): string => `https://www.strava.com/segments/${segmentId}`;

export interface SegmentGroup {
  key: string;
  segmentId: number | null;
  name: string;
  distance_m: number | null;
  grade_pct: number | null;
  bestKom: number | null;
  bestPr: number | null;
  count: number;
  lastDate: string | null;
  /** Temps des efforts classés, du plus ancien au plus récent. */
  times: { date: string; s: number }[];
}

/** Regroupe les efforts d'un même segment : meilleur rang, nombre d'efforts, progression des temps. */
export function groupBySegment(efforts: SegmentEffort[]): SegmentGroup[] {
  const map = new Map<string, SegmentGroup>();
  for (const e of efforts) {
    const key = e.segment_id !== null ? String(e.segment_id) : e.name;
    const g = map.get(key) ?? {
      key, segmentId: e.segment_id, name: e.name, distance_m: e.distance_m, grade_pct: e.grade_pct,
      bestKom: null, bestPr: null, count: 0, lastDate: null, times: [],
    }; // fmt: skip
    g.count += 1;
    if (e.kom_rank !== null) g.bestKom = Math.min(g.bestKom ?? 99, e.kom_rank);
    if (e.pr_rank !== null) g.bestPr = Math.min(g.bestPr ?? 99, e.pr_rank);
    if (e.date && (!g.lastDate || e.date > g.lastDate)) g.lastDate = e.date;
    if (e.date && e.elapsed_s !== null) g.times.push({ date: e.date, s: e.elapsed_s });
    map.set(key, g);
  }
  const groups = [...map.values()];
  for (const g of groups) g.times.sort((a, b) => a.date.localeCompare(b.date));
  return groups.sort(
    (a, b) =>
      (a.bestKom ?? 99) - (b.bestKom ?? 99) ||
      (a.bestPr ?? 99) - (b.bestPr ?? 99) ||
      (b.lastDate ?? "").localeCompare(a.lastDate ?? ""),
  );
}

/** Nombre de KOM top 10 et de records perso par mois, sur les `months` derniers mois. */
export function byMonth(efforts: SegmentEffort[], months: number, today = todayIso()): { month: string; label: string; kom: number; pr: number }[] {
  const out: { month: string; label: string; kom: number; pr: number }[] = [];
  const [y, m] = today.split("-").map(Number);
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(y ?? 1970, (m ?? 1) - 1 - i, 1);
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    out.push({ month, label: d.toLocaleDateString("fr-FR", { month: "short" }), kom: 0, pr: 0 });
  }
  for (const e of efforts) {
    const row = out.find((r) => e.date?.startsWith(r.month));
    if (!row) continue;
    if (e.kom_rank !== null) row.kom += 1;
    if (e.pr_rank !== null) row.pr += 1;
  }
  return out;
}

function Medal({ rank, kind }: { rank: number; kind: "kom" | "pr" }) {
  const color = kind === "pr" ? "var(--accent-2)" : rank === 1 ? GOLD : rank === 2 ? SILVER : rank === 3 ? BRONZE : "var(--muted)";
  const title = kind === "pr" ? (rank === 1 ? "Record personnel" : `${rank}e de tes efforts`) : rank === 1 ? "KOM / QOM : 1er au classement général" : `${rank}e au classement général`;
  return (
    <span className={`seg-medal seg-medal-${kind}`} style={{ borderColor: color, color }} title={title} aria-label={title}>
      {kind === "pr" ? (rank === 1 ? "★" : rank) : rank === 1 ? "👑" : rank}
    </span>
  );
}

/** Progression des temps (plus bas = plus rapide) : petite courbe, dernier point en couleur. */
function Sparkline({ times }: { times: { date: string; s: number }[] }) {
  if (times.length < 2) return null;
  const w = 120;
  const h = 28;
  const lo = Math.min(...times.map((t) => t.s));
  const hi = Math.max(...times.map((t) => t.s));
  const span = hi - lo || 1;
  const pts = times.map((t, i) => [(i / (times.length - 1)) * (w - 8) + 4, h - 4 - ((hi - t.s) / span) * (h - 8)] as const);
  const last = pts[pts.length - 1];
  return (
    <svg className="seg-spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Progression : ${formatDurationS(times[0]?.s ?? null)} puis ${formatDurationS(times[times.length - 1]?.s ?? null)}`}>
      <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--muted)" strokeWidth="1.5" />
      {last && <circle cx={last[0]} cy={last[1]} r="3" fill="var(--accent-2)" />}
    </svg>
  );
}

function SegmentCard({ g, full }: { g: SegmentGroup; full: boolean }) {
  const best = g.times.length ? Math.min(...g.times.map((t) => t.s)) : null;
  return (
    <li className="seg-card">
      <div className="seg-medals">
        {g.bestKom !== null && <Medal rank={g.bestKom} kind="kom" />}
        {g.bestPr !== null && <Medal rank={g.bestPr} kind="pr" />}
      </div>
      <div className="seg-body">
        {g.segmentId !== null ? (
          <a
            className="seg-name seg-link"
            href={segmentUrl(g.segmentId)}
            target="_blank"
            rel="noopener noreferrer"
            title="Voir le segment et son classement sur Strava"
            onClick={(event) => { event.stopPropagation(); }}
          >
            {g.name} ↗
          </a>
        ) : (
          <strong className="seg-name">{g.name}</strong>
        )}
        <span className="seg-meta">
          {g.distance_m !== null && `${formatNumber(g.distance_m)} m`}
          {g.grade_pct !== null && ` · ${formatNumber(g.grade_pct, 1)} %`}
          {best !== null && ` · record ${formatDurationS(best)}`}
        </span>
        {full && (
          <span className="seg-meta">
            {g.count} effort{g.count > 1 ? "s" : ""} classé{g.count > 1 ? "s" : ""}
            {g.lastDate && ` · dernier le ${formatDay(g.lastDate)}`}
          </span>
        )}
      </div>
      {full && <Sparkline times={g.times} />}
    </li>
  );
}

function MonthChart({ efforts, months }: { efforts: SegmentEffort[]; months: number }) {
  const data = byMonth(efforts, months);
  if (data.every((d) => d.kom === 0 && d.pr === 0)) return null;
  return (
    <div className="summary-chart seg-chart">
      <ChartBox minHeight={70}>
        {({ width, height }) => (
          <BarChart width={width} height={height} data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} interval={months > 12 ? 2 : 0} />
            <YAxis hide allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)", opacity: 0.6 }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, padding: "2px 8px" }}
              formatter={(v, name) => [String(v), name === "kom" ? "Places au top 10" : "Records perso"]}
            />
            <Bar dataKey="kom" stackId="a" fill={GOLD} isAnimationActive={false} />
            <Bar dataKey="pr" stackId="a" fill="var(--accent-2)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        )}
      </ChartBox>
    </div>
  );
}

function Legend() {
  return (
    <p className="seg-legend">
      <span><i style={{ background: GOLD }} /> Top 10 (KOM/QOM)</span>
      <span><i style={{ background: "var(--accent-2)" }} /> Records perso</span>
    </p>
  );
}

function Notes({ data }: { data: StravaSegments }) {
  return (
    <p className="muted">
      {data.note} Séances Strava analysées : {formatNumber(data.activities_scanned)} (les plus récentes d'abord, le
      reste se complète à chaque synchronisation).
    </p>
  );
}

function Segments({ settings, detail }: { settings: SegmentSettings; detail: boolean }) {
  const days = daysOf(settings.period);
  const query = useQuery({
    queryKey: ["strava", "segments", days],
    queryFn: () => fetchStravaSegments(days),
    refetchInterval: REFRESH_MS,
  });
  const kind = kindOf(settings.kind);
  const months = Math.round(days / 30);
  return (
    <WidgetData
      query={query}
      isEmpty={(d) => !d.connected || d.activities_scanned === 0}
      emptyMessage="Aucun segment pour l'instant : connecte Strava dans Sources et lance une synchronisation."
    >
      {(data) => {
        const efforts = data.efforts.filter(keep(kind));
        const groups = groupBySegment(efforts);
        const shown = detail ? groups : groups.slice(0, 3);
        return (
          <>
            <SummaryLayout
              value={formatNumber(data.top10)}
              unit="places au top 10 de segments"
              sub={`${formatNumber(data.kom)} KOM/QOM · ${formatNumber(data.pr)} record(s) perso · ${formatNumber(groups.length)} segment(s)`}
            >
              <MonthChart efforts={efforts} months={months} />
              {detail && <Legend />}
              {groups.length === 0 ? (
                <p className="muted">Aucun effort classé sur cette période.</p>
              ) : (
                <ul className={`seg-grid${detail ? " seg-grid-detail" : ""}`}>
                  {shown.map((g) => (
                    <SegmentCard key={g.key} g={g} full={detail} />
                  ))}
                </ul>
              )}
            </SummaryLayout>
            {detail && <Notes data={data} />}
          </>
        );
      }}
    </WidgetData>
  );
}

const Summary = ({ settings }: WidgetProps<SegmentSettings>) => <Segments settings={settings} detail={false} />;
const Detail = ({ settings }: WidgetProps<SegmentSettings>) => <Segments settings={settings} detail />;

registerWidget<SegmentSettings>({
  id: "strava-segments",
  title: "Segments Strava",
  description:
    "Tes KOM/QOM (top 10) et records personnels sur segments, d'après Strava, en médailles et en courbe par mois. Les Local Legends ne sont pas disponibles dans l'API Strava.",
  defaultSize: { w: 4, h: 5 },
  minSize: { w: 3, h: 3 },
  defaultSettings: { period: "365", kind: "all" },
  settingsSchema: [
    {
      key: "kind",
      label: "Afficher",
      type: "select",
      options: [
        { value: "all", label: "KOM et records perso" },
        { value: "kom", label: "Top 10 (KOM) seulement" },
        { value: "pr", label: "Records perso seulement" },
      ],
    },
    {
      key: "period",
      label: "Période",
      type: "select",
      options: [
        { value: "90", label: "3 mois" },
        { value: "365", label: "1 an" },
        { value: "730", label: "2 ans" },
      ],
    },
  ],
  Component: Detail,
  Summary,
  exportData: async (settings) => {
    const data = await fetchStravaSegments(daysOf(settings.period));
    const efforts = data.efforts.filter(keep(kindOf(settings.kind)));
    if (efforts.length === 0) return null;
    return {
      title: "Segments Strava",
      markdown: [
        `Segments classés (Strava, rangs au moment de l'envoi) — ${data.top10} au top 10, ${data.kom} KOM/QOM, ${data.pr} records perso.`,
        "",
        ...efforts.map((e) => `- ${e.date ?? "?"} · ${e.name} · ${rankLabels(e).join(", ")}`),
        "",
        data.note,
      ].join("\n"),
    };
  },
});

