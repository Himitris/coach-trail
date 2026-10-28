import type { ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, Cell, Line, LineChart, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";
import { ChartBox } from "./common";

const AXIS = { fontSize: 10, fill: "var(--muted)" };
const TOOLTIP = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12, padding: "2px 8px" },
  itemStyle: { padding: 0 },
  labelStyle: { color: "var(--muted)" },
};

export interface SummaryStat {
  label: string;
  value: ReactNode;
}

/**
 * Vue condensée d'un widget : un chiffre clé, quelques valeurs associées et un seul graphique
 * qui prend la place restante. Tout le détail reste dans la fenêtre ouverte au clic.
 */
export function SummaryLayout({
  value,
  unit,
  sub,
  tag,
  stats,
  children,
}: {
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  /** Pastille en haut à droite (niveau de preuve, tendance). */
  tag?: ReactNode;
  stats?: SummaryStat[];
  children?: ReactNode;
}) {
  return (
    <>
      <div className="summary-head">
        <span className="summary-value">{value}</span>
        {unit !== undefined && <span className="summary-unit">{unit}</span>}
        {tag !== undefined && <span className="summary-tag">{tag}</span>}
      </div>
      {sub !== undefined && <span className="summary-sub">{sub}</span>}
      {stats && stats.length > 0 && (
        <dl className="summary-stats">
          {stats.map((s) => (
            <div key={s.label}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </>
  );
}

export interface MiniPoint {
  label: string;
  value: number | null;
}

const fmtTip = (unit: string, digits = 0) => (v: unknown) =>
  [`${typeof v === "number" ? v.toLocaleString("fr-FR", { maximumFractionDigits: digits }) : "—"}${unit}`, ""] as [string, string];

/** Histogramme minimal ; la dernière barre en couleur pleine, la valeur au survol. */
export function MiniBars({ data, reference, unit = "", digits = 0 }: { data: MiniPoint[]; reference?: number; unit?: string; digits?: number }) {
  return (
    <div className="summary-chart">
      <ChartBox minHeight={40}>
        {({ width, height }) => (
          <BarChart width={width} height={height} data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis hide domain={[0, "auto"]} />
            <Tooltip cursor={false} {...TOOLTIP} formatter={fmtTip(unit, digits)} />
            {reference !== undefined && <ReferenceLine y={reference} stroke="var(--muted)" strokeDasharray="3 3" />}
            <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={`${d.label}-${i}`} fill="var(--accent)" fillOpacity={i === data.length - 1 ? 1 : 0.3} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ChartBox>
    </div>
  );
}

export interface LineSpec {
  key: string;
  color: string;
  dashed?: boolean;
}

/** Courbes minimales : une ou deux séries sur le même axe. */
export function MiniLines({ data, lines, unit = "", digits = 0 }: { data: Record<string, number | string | null>[]; lines: LineSpec[]; unit?: string; digits?: number }) {
  return (
    <div className="summary-chart">
      <ChartBox minHeight={40}>
        {({ width, height }) => (
          <LineChart width={width} height={height} data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
            <YAxis hide domain={["auto", "auto"]} />
            <Tooltip {...TOOLTIP} formatter={fmtTip(unit, digits)} />
            {lines.map((l) => (
              <Line key={l.key} type="monotone" dataKey={l.key} stroke={l.color} strokeWidth={2} strokeDasharray={l.dashed ? "4 3" : undefined} dot={false} isAnimationActive={false} connectNulls />
            ))}
          </LineChart>
        )}
      </ChartBox>
    </div>
  );
}

export function MiniLine({ data, unit, digits }: { data: MiniPoint[]; unit?: string; digits?: number }) {
  return <MiniLines data={data.map((d) => ({ label: d.label, value: d.value }))} lines={[{ key: "value", color: "var(--accent)" }]} unit={unit} digits={digits} />;
}

/** Profil (altitude en fonction de la distance). */
export function MiniArea({ data }: { data: MiniPoint[] }) {
  return (
    <div className="summary-chart">
      <ChartBox minHeight={40}>
        {({ width, height }) => (
          <AreaChart width={width} height={height} data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
            <YAxis hide domain={["auto", "auto"]} />
            <Area type="monotone" dataKey="value" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.15} strokeWidth={1.5} isAnimationActive={false} />
          </AreaChart>
        )}
      </ChartBox>
    </div>
  );
}

/** Barres empilées par zone (pourcentages) avec une ligne de repère. */
export function MiniStacked({ data, keys, reference }: { data: object[]; keys: { key: string; color: string }[]; reference?: number }) {
  return (
    <div className="summary-chart">
      <ChartBox minHeight={40}>
        {({ width, height }) => (
          <BarChart width={width} height={height} data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis hide domain={[0, 100]} />
            <Tooltip cursor={false} {...TOOLTIP} formatter={fmtTip(" %")} />
            {keys.map((k) => (
              <Bar key={k.key} dataKey={k.key} stackId="s" fill={k.color} isAnimationActive={false} />
            ))}
            {reference !== undefined && <ReferenceLine y={reference} stroke="var(--text)" strokeDasharray="3 3" />}
          </BarChart>
        )}
      </ChartBox>
    </div>
  );
}
