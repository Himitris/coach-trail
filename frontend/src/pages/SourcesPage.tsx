import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { fetchSyncStatus, runSync, type SourceHealth } from "../api/endpoints";
import { formatDateTime, STATE_LABELS } from "../app/format";
import { useToast } from "../app/toasts";
import { useSources } from "../app/useSources";
import { GarminLogin } from "./GarminLogin";

function SourceCard({ source }: { source: SourceHealth }) {
  const [loginOpen, setLoginOpen] = useState(false);
  const needsLogin = source.source === "garmin" && (source.state === "auth_required" || loginOpen);
  return (
    <li className={`source source-${source.state}`}>
      <div className="source-head">
        <h2>{source.label}</h2>
        <span className={`badge badge-${source.state}`}>{STATE_LABELS[source.state]}</span>
      </div>
      {source.badge && <p className="source-badge">{source.badge}</p>}
      {source.message && <p>{source.message}</p>}
      <dl className="source-dates">
        <dt>Dernière synchronisation réussie</dt>
        <dd>{formatDateTime(source.last_success_at)}</dd>
        <dt>Dernière erreur</dt>
        <dd>
          {formatDateTime(source.last_error_at)}
          {source.last_error_message && source.last_error_message !== source.message
            ? ` — ${source.last_error_message}`
            : ""}
        </dd>
      </dl>
      {source.source === "garmin" && !needsLogin && (
        <button type="button" className="btn btn-small" onClick={() => { setLoginOpen(true); }}>
          Se reconnecter à Garmin
        </button>
      )}
      {needsLogin && <GarminLogin onDone={() => { setLoginOpen(false); }} />}
    </li>
  );
}

export function SourcesPage() {
  const sources = useSources();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const status = useQuery({
    queryKey: ["sync-status"],
    queryFn: fetchSyncStatus,
    // Tant qu'une synchronisation tourne, on suit son avancement.
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  });
  const running = status.data?.running === true;

  const refreshSources = () => queryClient.invalidateQueries({ queryKey: ["sources"] });

  const sync = useMutation({
    mutationFn: runSync,
    onSuccess: async () => {
      notify("Synchronisation lancée.");
      await queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      // Une synchronisation courte peut être finie avant le premier suivi : on relit aussi les sources.
      await refreshSources();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        notify("Une synchronisation est déjà en cours.");
        void queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      } else {
        notify(error.message, "error");
      }
    },
  });

  // Quand une synchronisation suivie se termine, l'état des sources a changé.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) void queryClient.invalidateQueries({ queryKey: ["sources"] });
    wasRunning.current = running;
  }, [running, queryClient]);

  return (
    <section className="sources-page">
      <div className="toolbar">
        <h1>Santé des sources</h1>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={sync.isPending || running}
            onClick={() => { sync.mutate(); }}
          >
            {running ? "Synchronisation en cours…" : "Synchroniser maintenant"}
          </button>
        </div>
      </div>
      {status.data && (
        <p className="hint">
          Synchronisation automatique chaque nuit à {status.data.nightly_time}. L'interface ne lit que la base
          locale : les valeurs affichées restent disponibles même si une source tombe.
        </p>
      )}
      {sources.isPending && <p role="status">Chargement…</p>}
      {sources.isError && (
        <p role="alert">
          Impossible de lire l'état des sources : {sources.error.message}{" "}
          <button type="button" className="btn btn-small" onClick={() => void sources.refetch()}>
            Réessayer
          </button>
        </p>
      )}
      {sources.data && (
        <ul className="sources">
          {sources.data.map((source) => (
            <SourceCard key={source.source} source={source} />
          ))}
        </ul>
      )}
    </section>
  );
}
