import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchActivities } from "../api/endpoints";
import type { Activity } from "../api/types";
import { ActivityExportButton } from "../app/ExportButtons";
import {
  formatDay,
  formatDuration,
  formatKm,
  formatMeters,
  formatNumber,
  formatPace,
} from "../app/format";
import { ActivityDetailDialog } from "./ActivityDetailWidget";
import { formatRecentActivities } from "./exports";
import { sportLabel } from "./labels";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { sportField } from "./settingFields";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";
import { SummaryLayout } from "./summary";

interface RecentSettings extends Record<string, unknown> {
  count: number;
  sport: "all" | "run" | "trail" | "other";
}

const clampCount = (n: unknown): number => Math.min(10, Math.max(5, typeof n === "number" ? Math.round(n) : 7));

function ActivityTable({ items, onOpen }: { items: Activity[]; onOpen: (id: number) => void }) {
  const showGap = items.some((a) => a.gap_s_per_km !== null);
  return (
    <div className="table-scroll">
      <table className="data-table data-table-clickable data-table-left2">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Sortie</th>
            <th scope="col">Durée</th>
            <th scope="col">Distance</th>
            <th scope="col">D+</th>
            <th scope="col">FC moy.</th>
            {showGap && <th scope="col" title="Allure ajustée à la pente">GAP</th>}
            <th scope="col" title="Effort perçu, 0 à 10">RPE</th>
            <th scope="col"><span className="sr-only">Export</span></th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr
              key={a.id}
              tabIndex={0}
              role="button"
              aria-label={`Détail : ${sportLabel(a.sport)} du ${formatDay(a.day)}`}
              onClick={() => { onOpen(a.id); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(a.id);
                }
              }}
            >
              <td>{formatDay(a.day)}</td>
              <td>
                {sportLabel(a.sport)}
                {a.is_race && <span className="chip chip-race"> course</span>}
              </td>
              <td>{formatDuration(a.duration_min)}</td>
              <td>{formatKm(a.distance_km)}</td>
              <td>{formatMeters(a.dplus_m)}</td>
              <td>{a.hr_avg === null ? "—" : formatNumber(a.hr_avg)}</td>
              {showGap && <td>{formatPace(a.gap_s_per_km)}</td>}
              <td>{a.rpe === null ? "—" : a.rpe}</td>
              <td>
                <ActivityExportButton activityId={a.id} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecentActivitiesWidget({ settings }: WidgetProps<RecentSettings>) {
  const limit = clampCount(settings.count);
  const group = settings.sport;
  const [openId, setOpenId] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ["activities", "recent", limit, group],
    queryFn: () => fetchActivities({ limit, group }),
    refetchInterval: REFRESH_MS,
  });
  return (
    <>
      <WidgetData query={query} isEmpty={(items) => items.length === 0} emptyMessage="Aucune sortie enregistrée.">
        {(items) => <ActivityTable items={items} onOpen={setOpenId} />}
      </WidgetData>
      {openId !== null && <ActivityDetailDialog activityId={openId} onClose={() => { setOpenId(null); }} />}
    </>
  );
}

export function RecentActivitiesSummary({ settings }: WidgetProps<RecentSettings>) {
  const limit = clampCount(settings.count);
  const group = settings.sport;
  const query = useQuery({
    queryKey: ["activities", "recent", limit, group],
    queryFn: () => fetchActivities({ limit, group }),
    refetchInterval: REFRESH_MS,
  });
  return (
    <WidgetData query={query} isEmpty={(items) => items.length === 0} emptyMessage="Aucune sortie enregistrée.">
      {(items) => {
        const [last, ...others] = items;
        if (!last) return null;
        return (
          <SummaryLayout
            value={formatNumber(last.distance_km, 1)}
            unit="km"
            sub={`${sportLabel(last.sport)} · ${formatDay(last.day)} · ${formatDuration(last.duration_min)}`}
          >
            <ul className="summary-list">
              {others.slice(0, 3).map((a) => (
                <li key={a.id}>
                  <span>{sportLabel(a.sport)}</span>
                  <span className="muted">{formatDay(a.day)} · {formatNumber(a.distance_km, 1)} km</span>
                </li>
              ))}
            </ul>
          </SummaryLayout>
        );
      }}
    </WidgetData>
  );
}

registerWidget<RecentSettings>({
  id: "recent-activities",
  title: "Dernières sorties",
  description: "Les 5 à 10 dernières sorties (durée, distance, D+, FC, RPE) ; un clic ouvre le détail.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  defaultSettings: { count: 7, sport: "all" },
  settingsSchema: [{ key: "count", label: "Nombre de sorties (5 à 10)", type: "number", min: 5, max: 10, step: 1 }, sportField()],
  Component: RecentActivitiesWidget,
  Summary: RecentActivitiesSummary,
  exportData: async (settings) => ({
    title: "Dernières sorties",
    markdown: formatRecentActivities(
      await fetchActivities({ limit: clampCount(settings.count), group: settings.sport }),
    ),
  }),
});
