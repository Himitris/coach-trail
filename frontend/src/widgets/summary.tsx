import type { ReactNode } from "react";
import { Bar, BarChart, Cell, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartBox } from "./common";

/** Vue simple d'un widget : un chiffre clé, une phrase courte, un seul graphique. */
export function SummaryLayout({
  value,
  unit,
  sub,
  children,
}: {
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <>
      <div className="summary-head">
        <span className="summary-value">{value}</span>
        {unit !== undefined && <span className="summary-unit">{unit}</span>}
      </div>
      {sub !== undefined && <span className="summary-sub">{sub}</span>}
      {children}
    </>
  );
}

export interface MiniPoint {
  label: string;
  value: number | null;
}

/** Histogramme minimal : pas de grille ni d'axe vertical, la dernière barre en encre pleine. */
export function MiniBars({ data, reference }: { data: MiniPoint[]; reference?: number }) {
  return (
    <div className="summary-chart">
      <ChartBox minHeight={80}>
        {({ width, height }) => (
          <BarChart width={width} height={height} data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis hide domain={[0, "auto"]} />
            {reference !== undefined && <ReferenceLine y={reference} stroke="var(--muted)" strokeDasharray="3 3" />}
            <Bar dataKey="value" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={`${d.label}-${i}`} fill="var(--accent)" fillOpacity={i === data.length - 1 ? 1 : 0.28} />
              ))}
            </Bar>
          </BarChart>
        )}
      </ChartBox>
    </div>
  );
}

/** Courbe minimale d'une seule série. */
export function MiniLine({ data }: { data: MiniPoint[] }) {
  return (
    <div className="summary-chart">
      <ChartBox minHeight={80}>
        {({ width, height }) => (
          <LineChart width={width} height={height} data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted)" }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={40} />
            <YAxis hide domain={["auto", "auto"]} />
            <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          </LineChart>
        )}
      </ChartBox>
    </div>
  );
}
