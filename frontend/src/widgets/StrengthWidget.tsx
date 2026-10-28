import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { addStrengthSession, fetchStrength, setStrengthTarget } from "../api/endpoints";
import type { StrengthReport } from "../api/types";
import { formatDay, formatNumber, todayIso } from "../app/format";
import { EvidenceNote } from "./common";
import { formatStrength } from "./exports";
import { weeksSetting } from "./MonotonyWidget";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";
import { MiniBars, SummaryLayout } from "./summary";

interface StrengthSettings extends Record<string, unknown> {
  weeks: string;
}

function StrengthView({ report }: { report: StrengthReport }) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState(report.target === null ? "" : String(report.target));
  useEffect(() => { setTarget(report.target === null ? "" : String(report.target)); }, [report.target]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["metrics", "strength"] });
  const add = useMutation({ mutationFn: () => addStrengthSession(todayIso()), onSuccess: refresh });
  const save = useMutation({ mutationFn: (value: number | null) => setStrengthTarget(value), onSuccess: refresh });
  const current = report.weeks.at(-1);
  return (
    <div className="strength">
      {current && (
        <div className="stats">
          <div className="stat">
            <span className="stat-label">Cette semaine</span>
            <span className="stat-value" aria-label="Séances de renforcement cette semaine">
              {current.count}
              {report.target !== null && ` / ${report.target}`}
            </span>
            <span className="stat-sub">
              {current.detected} détectée(s) · {current.manual} saisie(s)
              {current.target_met === true && " · objectif atteint"}
            </span>
          </div>
        </div>
      )}
      <div className="entry-row">
        <button type="button" className="btn" disabled={add.isPending} onClick={() => { add.mutate(); }}>
          + Séance de renforcement aujourd'hui
        </button>
        <label className="field">
          <span className="muted">Objectif par semaine</span>
          <input
            type="number"
            min={0}
            max={14}
            value={target}
            onChange={(event) => { setTarget(event.target.value); }}
            onBlur={() => {
              const value = target.trim() === "" ? null : Math.round(Number(target));
              if (value !== report.target && (value === null || Number.isFinite(value))) save.mutate(value);
            }}
          />
        </label>
      </div>
      {(add.isError || save.isError) && <p className="form-error">{add.error?.message ?? save.error?.message}</p>}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Semaine du</th>
              <th scope="col">Séances</th>
              <th scope="col">Objectif</th>
            </tr>
          </thead>
          <tbody>
            {[...report.weeks].reverse().map((w) => (
              <tr key={w.week_start}>
                <th scope="row">{formatDay(w.week_start)}</th>
                <td>{w.count}</td>
                <td>{w.target === null ? "—" : w.target_met ? `${w.target} ✓` : w.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <EvidenceNote evidence={report.evidence} />
    </div>
  );
}

export function StrengthWidget({ settings }: WidgetProps<StrengthSettings>) {
  const weeks = weeksSetting(settings.weeks, 8);
  const query = useQuery({ queryKey: ["metrics", "strength", weeks], queryFn: () => fetchStrength(weeks), refetchInterval: REFRESH_MS });
  return <WidgetData query={query}>{(report) => <StrengthView report={report} />}</WidgetData>;
}

export function StrengthSummary({ settings }: WidgetProps<StrengthSettings>) {
  const weeks = weeksSetting(settings.weeks, 8);
  const query = useQuery({ queryKey: ["metrics", "strength", weeks], queryFn: () => fetchStrength(weeks), refetchInterval: REFRESH_MS });
  return (
    <WidgetData query={query}>
      {(report) => {
        const last = report.weeks.at(-1);
        return (
          <SummaryLayout
            value={formatNumber(last?.count ?? 0)}
            unit={report.target === null ? "séance(s) cette semaine" : `/ ${report.target} cette semaine`}
          >
            <MiniBars data={report.weeks.map((w) => ({ label: formatDay(w.week_start), value: w.count }))} reference={report.target ?? undefined} />
          </SummaryLayout>
        );
      }}
    </WidgetData>
  );
}

registerWidget<StrengthSettings>({
  id: "strength",
  title: "Renforcement",
  description: "Compteur hebdomadaire de séances de renforcement face à l'objectif que vous fixez.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
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
  Component: StrengthWidget,
  Summary: StrengthSummary,
  exportData: async (settings) => ({ title: "Renforcement", markdown: formatStrength(await fetchStrength(weeksSetting(settings.weeks, 8))) }),
});
