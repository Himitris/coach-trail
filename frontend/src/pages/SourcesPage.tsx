import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import {
  fetchBackupStatus,
  fetchStravaStatus,
  fetchSyncStatus,
  importActivityFile,
  checkSync,
  runSync,
  stravaAuthorize,
  stravaDisconnect,
  type SourceHealth,
} from "../api/endpoints";
import { formatBytes, formatDateTime, STATE_LABELS } from "../app/format";
import { navigateExternal } from "../app/navigation";
import { useToast } from "../app/toasts";
import { useSources } from "../app/useSources";
import { invalidateTraining } from "../widgets/queries";
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

/** Strava : optionnel, désactivé par défaut ; l'avertissement sur les conditions de l'API est toujours visible. */
function StravaCard() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const status = useQuery({ queryKey: ["strava"], queryFn: fetchStravaStatus });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["strava"] });
  const connect = useMutation({
    mutationFn: stravaAuthorize,
    onSuccess: ({ url }) => { navigateExternal(url); },
    onError: (error) => { notify(error.message, "error"); },
  });
  const disconnect = useMutation({
    mutationFn: stravaDisconnect,
    onSuccess: async () => {
      notify("Strava déconnecté.");
      await refresh();
    },
  });
  const s = status.data;
  const state = s?.connected ? "ok" : s?.enabled ? "auth_required" : "jamais_synchronise";
  const label = s === undefined ? "Chargement…" : s.connected ? "Connecté" : s.enabled ? "À connecter" : "Désactivé";
  return (
    <li className={`source source-${state}`} aria-label="Strava">
      <div className="source-head">
        <h2>Strava</h2>
        <span className={`badge badge-${state}`}>{label}</span>
      </div>
      {status.isError && <p>Impossible de lire l'état de Strava : {status.error.message}</p>}
      {s && (
        <>
          <p className="source-badge" role="note">{s.warning}</p>
          <p className="muted">{s.limits} Source optionnelle, priorité la plus basse (Garmin prévaut).</p>
          {!s.enabled && (
            <p>
              {s.requested
                ? "STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET sont requis."
                : "Désactivé par défaut : définir STRAVA_ENABLED=true, STRAVA_CLIENT_ID et STRAVA_CLIENT_SECRET."}{" "}
              URL de retour à déclarer chez Strava : <code>{s.redirect_uri}</code>
            </p>
          )}
          {s.enabled && !s.connected && (
            <button type="button" className="btn btn-small" disabled={connect.isPending} onClick={() => { connect.mutate(); }}>
              Connecter Strava
            </button>
          )}
          {s.connected && (
            <button
              type="button"
              className="btn btn-small"
              disabled={disconnect.isPending}
              onClick={() => { if (window.confirm("Déconnecter Strava ? Les séances déjà importées sont conservées.")) disconnect.mutate(); }}
            >
              Déconnecter Strava
            </button>
          )}
        </>
      )}
    </li>
  );
}

const IMPORT_SPORTS: [string, string][] = [
  ["", "Détecter automatiquement"],
  ["running", "Course à pied"],
  ["trail_running", "Trail"],
  ["hiking", "Randonnée"],
  ["cycling", "Vélo"],
];

/** Import manuel d'une séance .fit ou .gpx (secours si une source est indisponible, ou rattrapage). */
function ImportCard() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const [sport, setSport] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => importActivityFile(file, sport === "" ? null : sport),
    onSuccess: async (r) => {
      notify(r.created ? "Séance importée." : "Ce fichier était déjà importé : rien n'a changé.");
      await queryClient.invalidateQueries();
    },
    onError: (error) => { notify(error.message, "error"); },
  });
  const send = (files: FileList | null) => {
    const file = files?.[0];
    if (file) upload.mutate(file);
    if (input.current) input.current.value = "";
  };
  const r = upload.data;
  return (
    <li className="source source-jamais_synchronise" aria-label="Import de fichier">
      <div className="source-head">
        <h2>Import FIT / GPX</h2>
        <span className="badge badge-jamais_synchronise">Manuel</span>
      </div>
      <p className="muted">
        Source de dernier recours (priorité la plus basse) : une séance déjà connue de Garmin ou d'Intervals.icu
        n'est pas comptée deux fois. 20 Mo maximum.
      </p>
      <label>
        Sport{" "}
        <select value={sport} onChange={(e) => { setSport(e.target.value); }}>
          {IMPORT_SPORTS.map(([value, name]) => (
            <option key={value} value={value}>{name}</option>
          ))}
        </select>
      </label>
      <div
        className={`dropzone${over ? " dropzone-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => { setOver(false); }}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
      >
        <p>Déposer un fichier .fit ou .gpx ici, ou</p>
        <button type="button" className="btn btn-small" disabled={upload.isPending} onClick={() => input.current?.click()}>
          {upload.isPending ? "Import en cours…" : "Choisir un fichier"}
        </button>
        <input ref={input} type="file" accept=".fit,.gpx" hidden aria-label="Fichier à importer" onChange={(e) => { send(e.target.files); }} />
      </div>
      {r && (
        <div role="status">
          <p>
            {r.created ? "Importée" : "Déjà importée"} : {r.sport.replace("_", " ")}, {Math.round(r.duration_min)} min
            {r.distance_km !== null && `, ${r.distance_km.toFixed(1).replace(".", ",")} km`}
            {r.dplus_m !== null && `, D+ ${Math.round(r.dplus_m)} m`}
            {r.hr_avg !== null && `, FC moy. ${r.hr_avg}`}.
          </p>
          {r.same_session_as.length > 0 && (
            <p>Même séance que celle déjà reçue de : {r.same_session_as.join(", ")} (comptée une seule fois).</p>
          )}
          {!r.has_stream && <p className="muted">Pas de flux seconde par seconde dans ce fichier.</p>}
          {r.warnings.length > 0 && (
            <ul>
              {r.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function BackupCard() {
  const backup = useQuery({ queryKey: ["backup"], queryFn: fetchBackupStatus, refetchInterval: 300_000 });
  const b = backup.data;
  const state = b === undefined ? "down" : b.ok === true && !b.stale ? "ok" : b.ok === null ? "jamais_synchronise" : "down";
  const label = b === undefined ? (backup.isError ? "Illisible" : "Chargement…") : b.ok === null ? "Aucune sauvegarde" : b.ok ? (b.stale ? "Ancienne" : "Réussie") : "Échec";
  return (
    <li className={`source source-${state}`} aria-label="Sauvegardes">
      <div className="source-head">
        <h2>Sauvegardes</h2>
        <span className={`badge badge-${state}`}>{label}</span>
      </div>
      {backup.isError && <p>Impossible de lire l'état des sauvegardes : {backup.error.message}</p>}
      {b && (
        <>
          <p>{b.message}</p>
          {b.warning && <p className="source-badge">{b.warning}</p>}
          <dl className="source-dates">
            <dt>Dernière sauvegarde</dt>
            <dd>{formatDateTime(b.last_run_at)}</dd>
            <dt>Taille</dt>
            <dd>{formatBytes(b.size_bytes)}</dd>
            <dt>Contrôle d'intégrité</dt>
            <dd>{b.integrity === "ok" ? "réussi" : (b.integrity ?? "—")}</dd>
            <dt>Copies conservées</dt>
            <dd>
              {b.daily} quotidiennes · {b.weekly} hebdomadaires · {b.monthly} mensuelles ({formatBytes(b.total_size_bytes)})
            </dd>
          </dl>
        </>
      )}
    </li>
  );
}

export function SourcesPage() {
  const sources = useSources();
  const queryClient = useQueryClient();
  const { notify } = useToast();
  // Retour de Strava (/sources?strava=ok|refuse|erreur) : on le dit, puis on nettoie l'adresse.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("strava");
    if (result === null) return;
    notify(
      result === "ok" ? "Strava connecté : première synchronisation lancée." : result === "refuse" ? "Connexion Strava refusée ou expirée." : "La connexion Strava a échoué.",
      result === "ok" ? "info" : "error",
    );
    void queryClient.invalidateQueries({ queryKey: ["strava"] });
    window.history.replaceState(null, "", "/sources");
  }, [notify, queryClient]);
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

  /** Lance la vérification rapide puis attend la fin du run pour annoncer le nombre de nouveautés. */
  const check = useMutation({
    mutationFn: async () => {
      const before = (await fetchSyncStatus()).last_run?.started_at ?? null;
      await checkSync();
      for (let i = 0; i < 90; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, i === 0 ? 300 : 1000));
        const now = await fetchSyncStatus();
        if (!now.running && now.last_run && now.last_run.started_at !== before) return now.last_run;
      }
      return null;
    },
    onSuccess: async (run) => {
      await queryClient.invalidateQueries({ queryKey: ["sync-status"] });
      await refreshSources();
      await invalidateTraining(queryClient);
      if (!run) return notify("La vérification dure plus longtemps que prévu ; elle continue en arrière-plan.");
      const failed = run.results.some((r) => !r.ok);
      const added = run.results.reduce((n, r) => n + r.inserted, 0);
      if (failed && added === 0) return notify("Vérification impossible : voir l'état des sources.", "error");
      notify(added === 0 ? "Rien de nouveau." : `${added} nouvelle(s) activité(s).`);
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
            disabled={sync.isPending || check.isPending || running}
            onClick={() => { sync.mutate(); }}
          >
            {running ? "Synchronisation en cours…" : "Synchroniser maintenant"}
          </button>
          <button
            type="button"
            className="btn"
            title="Ne récupère que les activités plus récentes que la dernière connue"
            disabled={sync.isPending || check.isPending || running}
            onClick={() => { check.mutate(); }}
          >
            {check.isPending ? "Vérification…" : "Vérifier les nouveautés"}
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
          <StravaCard />
          <ImportCard />
          <BackupCard />
        </ul>
      )}
    </section>
  );
}
