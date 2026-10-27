import type { UseQueryResult } from "@tanstack/react-query";
import { Component, type ErrorInfo, type ReactNode } from "react";

/** États homogènes des widgets : chargement, vide, erreur. */

export function WidgetLoading({ label = "Chargement…" }: { label?: string }) {
  return (
    <div className="widget-state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function WidgetEmpty({ message = "Aucune donnée pour cette période." }: { message?: string }) {
  return (
    <div className="widget-state widget-state-empty">
      <span>{message}</span>
    </div>
  );
}

export function WidgetError({
  message = "Impossible d'afficher ce widget.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="widget-state widget-state-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Réessayer
        </button>
      )}
    </div>
  );
}

/** Affiche l'état d'une requête TanStack Query, puis le contenu quand les données sont là. */
export function WidgetData<T>({
  query,
  isEmpty,
  emptyMessage,
  children,
}: {
  query: UseQueryResult<T>;
  isEmpty?: (data: T) => boolean;
  emptyMessage?: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <WidgetLoading />;
  if (query.isError) {
    return <WidgetError message={query.error.message} onRetry={() => void query.refetch()} />;
  }
  if (isEmpty?.(query.data)) return <WidgetEmpty message={emptyMessage} />;
  return <>{children(query.data)}</>;
}

interface BoundaryProps {
  children: ReactNode;
  /** Change quand le contenu doit être ré-essayé (ex. réglages modifiés). */
  resetKey?: unknown;
}

/** Un widget qui plante n'emporte pas la page : seul son cadre affiche l'erreur. */
export class WidgetErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Widget en erreur :", error.message, info.componentStack);
  }

  override componentDidUpdate(prev: BoundaryProps): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <WidgetError onRetry={() => this.setState({ failed: false })} />;
    }
    return this.props.children;
  }
}
