import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from "recharts";
import { createFueling, deleteFueling, fetchFuelingSeries, updateFueling } from "../api/endpoints";
import type { FuelingPoint, FuelingSeries } from "../api/types";
import { formatDay, formatDuration, formatKm, formatNumber, formatSigned } from "../app/format";
import { ChartBox, EvidenceNote, EvidenceBadge } from "./common";
import { formatFueling } from "./exports";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";
import { MiniLine, SummaryLayout } from "./summary";

interface FuelingSettings extends Record<string, unknown> {
  minHours: string;
}

const minHoursOf = (value: unknown): number => {
  const n = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 12 ? n : 2.5;
};

/** Saisie rapide pour une sortie : g/h et score digestif 0–5 (un appui par valeur). */
export function FuelingForm({ activityId, point }: { activityId: number; point?: FuelingPoint }) {
  const queryClient = useQueryClient();
  const [carbs, setCarbs] = useState(point?.carbs_g_per_h == null ? "" : String(point.carbs_g_per_h));
  const [gi, setGi] = useState<number | null>(point?.gi_score ?? null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["fueling"] });
  const entryId = point?.entry_id ?? null;
  const save = useMutation({
    mutationFn: () => {
      const body = { glucides_g_par_h: Number(carbs), score_digestif: gi ?? 0 };
      return entryId === null ? createFueling(activityId, body) : updateFueling(entryId, body);
    },
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: () => deleteFueling(entryId ?? 0), onSuccess: refresh });
  const valid = carbs.trim() !== "" && Number.isFinite(Number(carbs)) && Number(carbs) >= 0 && Number(carbs) <= 300 && gi !== null;
  return (
    <form
      className="fueling-form"
      aria-label={`Nutrition de la sortie ${activityId}`}
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) save.mutate();
      }}
    >
      <label className="field">
        <span className="muted">Glucides (g/h)</span>
        <input type="number" min={0} max={300} step={1} value={carbs} onChange={(event) => { setCarbs(event.target.value); }} />
      </label>
      <fieldset className="scale">
        <legend className="muted">Score digestif (0 aucun trouble · 5 très gênant)</legend>
        <div className="scale-row">
          {Array.from({ length: 6 }, (_, n) => (
            <button
              key={n}
              type="button"
              className={`scale-btn${gi === n ? " scale-btn-on" : ""}`}
              aria-pressed={gi === n}
              aria-label={`Score digestif : ${n}`}
              onClick={() => { setGi(gi === n ? null : n); }}
            >
              {n}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="entry-row">
        <button type="submit" className="btn btn-primary btn-small" disabled={!valid || save.isPending}>
          {entryId === null ? "Enregistrer" : "Mettre à jour"}
        </button>
        {entryId !== null && (
          <button type="button" className="btn btn-small" disabled={remove.isPending} onClick={() => { remove.mutate(); }}>
            Supprimer
          </button>
        )}
      </div>
      {(save.isError || remove.isError) && <p className="form-error">{save.error?.message ?? remove.error?.message}</p>}
    </form>
  );
}

export function FuelingView({ series }: { series: FuelingSeries }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const data = series.points.map((p) => ({ date: p.day, carbs: p.carbs_g_per_h, gi: p.gi_score }));
  return (
    <div className="fueling">
      {series.points.some((p) => p.carbs_g_per_h !== null) && (
        <ChartBox minHeight={160}>
          {({ width }) => (
            <ComposedChart width={width} height={160} data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d: string) => formatDay(d)} minTickGap={24} />
              <YAxis tick={{ fontSize: 11 }} width={36} domain={[0, (max: number) => Math.max(60, Math.ceil(max / 10) * 10)]} />
              <Tooltip
                labelFormatter={(d) => formatDay(String(d))}
                formatter={(value, name) => [name === "carbs" ? `${formatNumber(Number(value))} g/h` : String(value), name === "carbs" ? "Glucides" : "Score digestif"]}
              />
              <Line type="monotone" dataKey="carbs" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
            </ComposedChart>
          )}
        </ChartBox>
      )}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Sortie</th>
              <th scope="col">Durée</th>
              <th scope="col">Glucides</th>
              <th scope="col">Variation</th>
              <th scope="col">Digestif</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            {[...series.points].reverse().map((p) => (
              <tr key={p.activity_id}>
                <th scope="row">
                  {formatDay(p.day)}
                  {p.distance_km !== null && <span className="muted"> · {formatKm(p.distance_km)}</span>}
                </th>
                <td>{formatDuration(p.duration_h * 60)}</td>
                <td>{p.carbs_g_per_h === null ? <span className="muted">à saisir</span> : `${formatNumber(p.carbs_g_per_h)} g/h`}</td>
                <td>{p.carbs_change_g_per_h === null ? "—" : `${formatSigned(p.carbs_change_g_per_h, 0)} g/h`}</td>
                <td>{p.gi_score === null ? "—" : `${p.gi_score}/5`}</td>
                <td>
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-expanded={openId === p.activity_id}
                    onClick={() => { setOpenId(openId === p.activity_id ? null : p.activity_id); }}
                  >
                    {p.entry_id === null ? "Saisir" : "Modifier"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {series.points.map(
        (p) => openId === p.activity_id && <FuelingForm key={p.activity_id} activityId={p.activity_id} point={p} />,
      )}
      {series.missing > 0 && <p className="muted">{series.missing} sortie(s) longue(s) sans saisie de nutrition.</p>}
      <EvidenceNote evidence={series.evidence} />
    </div>
  );
}

export function FuelingWidget({ settings }: WidgetProps<FuelingSettings>) {
  const minHours = minHoursOf(settings.minHours);
  const query = useQuery({
    queryKey: ["fueling", "series", minHours],
    queryFn: () => fetchFuelingSeries(minHours),
    refetchInterval: REFRESH_MS,
  });
  return (
    <WidgetData
      query={query}
      isEmpty={(s) => s.points.length === 0}
      emptyMessage={`Aucune sortie de plus de ${formatNumber(minHours, 1)} h pour l'instant.`}
    >
      {(series) => <FuelingView series={series} />}
    </WidgetData>
  );
}

export function FuelingSummary({ settings }: WidgetProps<FuelingSettings>) {
  const minHours = minHoursOf(settings.minHours);
  const query = useQuery({
    queryKey: ["fueling", "series", minHours],
    queryFn: () => fetchFuelingSeries(minHours),
    refetchInterval: REFRESH_MS,
  });
  return (
    <WidgetData
      query={query}
      isEmpty={(s) => s.points.length === 0}
      emptyMessage={`Aucune sortie de plus de ${formatNumber(minHours, 1)} h pour l'instant.`}
    >
      {(series) => {
        const withCarbs = series.points.filter((p) => p.carbs_g_per_h !== null);
        const last = withCarbs.at(-1);
        const mean = withCarbs.length ? withCarbs.reduce((sum, p) => sum + (p.carbs_g_per_h ?? 0), 0) / withCarbs.length : null;
        return (
          <SummaryLayout
            value={last ? formatNumber(last.carbs_g_per_h) : "—"}
            unit="g glucides / h"
            tag={<EvidenceBadge evidence={series.evidence} />}
            sub={last ? `Dernière : ${formatDay(last.day)} · ${formatNumber(last.duration_h, 1)} h` : "Aucune nutrition saisie"}
            stats={[
              { label: "Moyenne", value: mean === null ? "—" : `${formatNumber(mean)} g/h` },
              { label: "Digestion", value: last?.gi_score == null ? "—" : `${last.gi_score}/10` },
              { label: "Sorties", value: formatNumber(series.points.length) },
              ...(series.missing > 0 ? [{ label: "À saisir", value: formatNumber(series.missing) }] : []),
            ]}
          >
            <MiniLine data={series.points.map((p) => ({ label: formatDay(p.day), value: p.carbs_g_per_h }))} unit=" g/h" />
          </SummaryLayout>
        );
      }}
    </WidgetData>
  );
}

registerWidget<FuelingSettings>({
  id: "fueling",
  title: "Nutrition en course",
  description: "Glucides par heure et score digestif des longues sorties, courbe de progression et saisie rapide.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  defaultSettings: { minHours: "2.5" },
  settingsSchema: [
    {
      key: "minHours",
      label: "Sortie longue à partir de",
      type: "select",
      options: [
        { value: "2", label: "2 h" },
        { value: "2.5", label: "2 h 30" },
        { value: "3", label: "3 h" },
        { value: "4", label: "4 h" },
      ],
    },
  ],
  Component: FuelingWidget,
  Summary: FuelingSummary,
  exportData: async (settings) => ({ title: "Nutrition en course", markdown: formatFueling(await fetchFuelingSeries(minHoursOf(settings.minHours))) }),
});
