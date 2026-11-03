import { useQuery } from "@tanstack/react-query";
import { fetchStravaSegments, type SegmentEffort, type StravaSegments } from "../api/endpoints";
import { formatDay, formatDurationS, formatNumber } from "../app/format";
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

/** « KOM #1 », « Top 10 · 4ᵉ », « Record perso » : le rang tel que Strava l'a donné à l'envoi. */
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

function EffortList({ efforts, limit }: { efforts: SegmentEffort[]; limit?: number }) {
  const shown = limit ? efforts.slice(0, limit) : efforts;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Segment</th>
            <th scope="col">Rang</th>
            <th scope="col">Date</th>
            {!limit && <th scope="col">Longueur</th>}
            {!limit && <th scope="col">Pente</th>}
            {!limit && <th scope="col">Temps</th>}
          </tr>
        </thead>
        <tbody>
          {shown.map((e, i) => (
            <tr key={`${e.segment_id ?? e.name}-${e.date}-${i}`}>
              <th scope="row">{e.name}</th>
              <td>{rankLabels(e).join(" · ")}</td>
              <td>{e.date ? formatDay(e.date) : "—"}</td>
              {!limit && <td>{e.distance_m === null ? "—" : `${formatNumber(e.distance_m)} m`}</td>}
              {!limit && <td>{e.grade_pct === null ? "—" : `${formatNumber(e.grade_pct, 1)} %`}</td>}
              {!limit && <td>{formatDurationS(e.elapsed_s)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
  const query = useQuery({
    queryKey: ["strava", "segments", daysOf(settings.period)],
    queryFn: () => fetchStravaSegments(daysOf(settings.period)),
    refetchInterval: REFRESH_MS,
  });
  const kind = kindOf(settings.kind);
  return (
    <WidgetData
      query={query}
      isEmpty={(d) => !d.connected || d.activities_scanned === 0}
      emptyMessage="Aucun segment pour l'instant : connecte Strava dans Sources et lance une synchronisation."
    >
      {(data) => {
        const efforts = data.efforts.filter(keep(kind));
        return (
          <>
            <SummaryLayout
              value={formatNumber(data.top10)}
              unit="places au top 10 de segments"
              sub={`dont ${formatNumber(data.kom)} KOM/QOM · ${formatNumber(data.pr)} record(s) perso`}
            >
              {efforts.length === 0 ? (
                <p className="muted">Aucun effort classé sur cette période.</p>
              ) : (
                <EffortList efforts={efforts} limit={detail ? undefined : 4} />
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
    "Tes KOM/QOM (top 10) et records personnels sur segments, d'après Strava. Les Local Legends ne sont pas disponibles dans l'API Strava.",
  defaultSize: { w: 3, h: 4 },
  minSize: { w: 2, h: 3 },
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
