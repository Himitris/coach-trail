import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Direction, Evidence, EvidenceLevel, Trend } from "../api/types";

/** Petit libellé de niveau de preuve ; la phrase complète est dans l'infobulle. */
const EVIDENCE_LABELS: Record<EvidenceLevel, string> = {
  etabli: "mesure",
  indicatif: "indicatif",
  non_valide: "non validé",
  avis_montre: "avis de la montre, non validé",
};

export function EvidenceBadge({ evidence, label }: { evidence: Evidence; label?: string }) {
  return (
    <span className={`evidence evidence-${evidence.level}`} title={evidence.summary}>
      {label ?? EVIDENCE_LABELS[evidence.level]}
    </span>
  );
}

/** Phrase de bas de widget : niveau de preuve + explication, toujours visible. */
export function EvidenceNote({ evidence, label }: { evidence: Evidence; label?: string }) {
  return (
    <p className="evidence-note">
      <EvidenceBadge evidence={evidence} label={label} /> {evidence.summary}
    </p>
  );
}

const DIRECTION_TEXT: Record<Direction, string> = {
  hausse: "↗ en hausse",
  baisse: "↘ en baisse",
  stable: "→ stable",
  indetermine: "tendance indéterminée",
};

/** Tendance en mots : neutre (jamais de rouge/vert, pas de jugement). */
export function TrendWord({ trend, className = "" }: { trend: Trend; className?: string }) {
  return (
    <span className={`trend trend-${trend.direction} ${className}`} title={trend.window}>
      {DIRECTION_TEXT[trend.direction]}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub !== undefined && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

const FALLBACK_SIZE = { width: 400, height: 200 };

/** Taille d'un élément, suivie à la volée (les graphiques ont besoin de dimensions explicites). */
export function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  // Sans ResizeObserver (tests jsdom), on garde une taille fixe pour que les graphiques se dessinent.
  const resolved =
    typeof ResizeObserver === "undefined" && size.width === 0 ? FALLBACK_SIZE : size;
  return [ref, resolved];
}

/** Zone de graphique qui occupe la place disponible du cadre. */
export function ChartBox({
  minHeight = 140,
  children,
}: {
  minHeight?: number;
  children: (size: { width: number; height: number }) => ReactNode;
}) {
  const [ref, size] = useElementSize<HTMLDivElement>();
  return (
    <div ref={ref} className="chart-box" style={{ minHeight }}>
      {size.width > 0 && size.height > 0 && children(size)}
    </div>
  );
}
