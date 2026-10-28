import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ApiError } from "../api/client";
import { clearGoalProfile, fetchGoals, fetchRaceGoal, importGoalGpx, setGoalProfile } from "../api/endpoints";
import type { RaceGoalReport } from "../api/types";
import { formatDay, formatDurationS, formatKm, formatMeters, formatNumber, formatSigned } from "../app/format";
import { ChartBox, EvidenceNote, Stat } from "./common";
import { formatRaceGoal } from "./exports";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData, WidgetEmpty, WidgetLoading } from "./states";
import type { WidgetProps } from "./types";
import { SummaryLayout } from "./summary";

interface RaceGoalSettings extends Record<string, unknown> {
  goalId: number | null;
}

const goalIdOf = (value: unknown): number | null => (typeof value === "number" && Number.isInteger(value) ? value : null);

/** « km;altitude » par ligne (séparateurs ; , espace ou tabulation, virgule décimale acceptée). */
export function parseProfile(text: string): { points: [number, number][] } | { error: string } {
  const points: [number, number][] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  for (const [i, line] of lines.entries()) {
    const parts = line.trim().split(/[;\t ]+/);
    const [km, alt] = parts.map((p) => Number(p.replace(",", ".")));
    if (parts.length !== 2 || km === undefined || alt === undefined || !Number.isFinite(km) || !Number.isFinite(alt)) {
      return { error: `Ligne ${i + 1} : attendu « kilomètre;altitude ».` };
    }
    const previous = points.at(-1);
    if (km < 0 || (previous && km <= previous[0])) return { error: `Ligne ${i + 1} : les kilomètres doivent croître.` };
    points.push([km, alt]);
  }
  if (points.length < 2) return { error: "Au moins 2 points sont nécessaires." };
  return { points };
}

function ProfileEditor({ report }: { report: RaceGoalReport }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const done = () => {
    setMessage(null);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: ["race-goal"] }),
      queryClient.invalidateQueries({ queryKey: ["goals"] }),
    ]);
  };
  const fail = (error: Error) => { setMessage(error instanceof ApiError ? error.message : "L'enregistrement a échoué."); };
  const savePoints = useMutation({ mutationFn: (points: [number, number][]) => setGoalProfile(report.goal_id, points), onSuccess: done, onError: fail });
  const gpx = useMutation({ mutationFn: (content: string) => importGoalGpx(report.goal_id, content, true), onSuccess: done, onError: fail });
  const clear = useMutation({ mutationFn: () => clearGoalProfile(report.goal_id), onSuccess: done, onError: fail });
  return (
    <details className="profile-editor">
      <summary>{report.profile ? "Modifier le profil de la course" : "Ajouter le profil de la course"}</summary>
      <label className="field">
        <span className="muted">Points « kilomètre;altitude », un par ligne</span>
        <textarea rows={4} value={text} placeholder={"0;300\n12,5;820\n31;310"} onChange={(event) => { setText(event.target.value); }} />
      </label>
      <div className="entry-row">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            const parsed = parseProfile(text);
            if ("error" in parsed) setMessage(parsed.error);
            else savePoints.mutate(parsed.points);
          }}
        >
          Enregistrer les points
        </button>
        <label className="btn btn-small">
          Importer une trace GPX
          <input
            type="file"
            accept=".gpx,application/gpx+xml,text/xml"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void file.text().then((content) => { gpx.mutate(content); });
              event.target.value = "";
            }}
          />
        </label>
        {report.profile && (
          <button type="button" className="btn btn-small" onClick={() => { clear.mutate(); }}>
            Supprimer le profil
          </button>
        )}
      </div>
      {message && <p className="form-error" role="alert">{message}</p>}
    </details>
  );
}

function ProfileChart({ profile }: { profile: [number, number][] }) {
  const data = profile.map(([km, alt]) => ({ km, alt }));
  return (
    <ChartBox minHeight={140}>
      {({ width }) => (
        <AreaChart width={width} height={140} data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="km" type="number" domain={[0, "dataMax"]} tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${formatNumber(v)} km`} />
          <YAxis tick={{ fontSize: 11 }} width={40} domain={["dataMin - 20", "dataMax + 20"]} tickFormatter={(v: number) => String(Math.round(v))} />
          <Tooltip labelFormatter={(v) => `${formatNumber(Number(v), 1)} km`} formatter={(v) => [`${formatNumber(Number(v))} m`, "Altitude"]} />
          <Area type="monotone" dataKey="alt" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.18} isAnimationActive={false} />
        </AreaChart>
      )}
    </ChartBox>
  );
}

const pct = (v: number | null): string => (v === null ? "—" : `${formatNumber(v)} %`);

export function RaceGoalView({ report }: { report: RaceGoalReport }) {
  const v = report.recent;
  const rows: [string, string, string | null, number | null][] = [
    ["Distance hebdo moyenne", formatKm(v.avg_weekly_km), report.distance_km === null ? null : formatKm(report.distance_km), v.avg_weekly_km_vs_race_pct],
    ["D+ hebdo moyen", formatMeters(v.avg_weekly_dplus_m), report.dplus_m === null ? null : formatMeters(report.dplus_m), v.avg_weekly_dplus_vs_race_pct],
    ["Plus longue sortie", v.longest_km === null ? "—" : formatKm(v.longest_km), report.distance_km === null ? null : formatKm(report.distance_km), v.longest_km_vs_race_pct],
    ["D+ de la plus longue", v.longest_dplus_m === null ? "—" : formatMeters(v.longest_dplus_m), report.dplus_m === null ? null : formatMeters(report.dplus_m), v.longest_dplus_vs_race_pct],
  ];
  return (
    <div className="race-goal">
      <div className="stats">
        <Stat label={report.nom} value={report.days_left === 0 ? "aujourd'hui" : `J−${report.days_left}`} sub={formatDay(report.date)} />
        <Stat label="Distance" value={report.distance_km === null ? "—" : formatKm(report.distance_km)} />
        <Stat
          label="D+"
          value={report.dplus_m === null ? "—" : formatMeters(report.dplus_m)}
          sub={report.profile_dplus_m !== null && `profil : ${formatMeters(report.profile_dplus_m)}`}
        />
      </div>
      {report.profile ? <ProfileChart profile={report.profile} /> : <p className="muted">Profil altimétrique de la course non renseigné.</p>}
      <ProfileEditor report={report} />
      <h3 className="sub">Vos {v.window_days} derniers jours face à la course</h3>
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col">Réalisé</th>
              <th scope="col">Course</th>
              <th scope="col">Part</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, done, race, share]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>{done}</td>
                <td>{race ?? "—"}</td>
                <td>{pct(share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <EvidenceNote evidence={v.evidence} />
      {report.projection && (
        <>
          <h3 className="sub">TSB projeté au {formatDay(report.projection.race_date)}</h3>
          <ul className="notes">
            {report.projection.scenarios.map((s) => (
              <li key={s.name}>
                {s.name} : TSB <strong>{formatSigned(s.tsb, 1)}</strong> (CTL {formatNumber(s.ctl, 1)} · ATL {formatNumber(s.atl, 1)})
              </li>
            ))}
          </ul>
          <EvidenceNote evidence={report.projection.evidence} />
        </>
      )}
      {report.predictions.length > 0 && (
        <>
          <h3 className="sub">Prédictions de la montre</h3>
          <ul className="notes">
            {report.predictions.map((p) => (
              <li key={p.label}>
                {p.label} : {formatDurationS(p.seconds)} <span className="muted">({p.note})</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function RaceGoalWidget({ settings, updateSettings }: WidgetProps<RaceGoalSettings>) {
  const goalId = goalIdOf(settings.goalId);
  const goals = useQuery({ queryKey: ["goals"], queryFn: fetchGoals });
  const query = useQuery({
    queryKey: ["race-goal", goalId],
    queryFn: () => fetchRaceGoal(goalId),
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  const empty = query.isError && query.error instanceof ApiError && query.error.status === 404;
  return (
    <>
      {(goals.data?.length ?? 0) > 1 && (
        <div className="field detail-picker">
          <label htmlFor="race-goal-picker">Objectif</label>
          <select
            id="race-goal-picker"
            value={goalId === null ? "next" : String(goalId)}
            onChange={(event) => { updateSettings({ goalId: event.target.value === "next" ? null : Number(event.target.value) }); }}
          >
            <option value="next">Prochaine course</option>
            {(goals.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.nom} · {formatDay(g.date)}
              </option>
            ))}
          </select>
        </div>
      )}
      {empty ? (
        <WidgetEmpty message="Aucun objectif de course à venir : ajoutez-en un (nom, date, distance, D+)." />
      ) : (
        <WidgetData query={query}>{(report) => <RaceGoalView report={report} />}</WidgetData>
      )}
    </>
  );
}

export function RaceGoalSummary({ settings }: WidgetProps<RaceGoalSettings>) {
  const goalId = goalIdOf(settings.goalId);
  const query = useQuery({
    queryKey: ["race-goal", goalId],
    queryFn: () => fetchRaceGoal(goalId),
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  if (query.isPending) return <WidgetLoading />;
  if (query.isError) {
    return <WidgetEmpty message="Aucun objectif de course : ouvrez le détail pour en choisir un." />;
  }
  const race = query.data;
  return (
    <SummaryLayout
      value={`J-${race.days_left}`}
      sub={[race.nom, formatDay(race.date), race.distance_km === null ? null : `${formatNumber(race.distance_km)} km`, race.dplus_m === null ? null : `${formatNumber(race.dplus_m)} m D+`].filter(Boolean).join(" · ")}
    />
  );
}

registerWidget<RaceGoalSettings>({
  id: "race-goal",
  title: "Objectif de course",
  description: "Compte à rebours, volume des 4 dernières semaines face au profil de la course, TSB projeté, profil D+ (saisie ou GPX).",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  defaultSettings: { goalId: null },
  settingsSchema: [],
  Component: RaceGoalWidget,
  Summary: RaceGoalSummary,
  exportData: async (settings) => {
    try {
      return { title: "Objectif de course", markdown: formatRaceGoal(await fetchRaceGoal(goalIdOf(settings.goalId))) };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
});
