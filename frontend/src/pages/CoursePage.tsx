import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { clearRaceChecks, deleteRacePlan, fetchGoals, fetchRaceGoal, fetchRacePlan, setRaceCheck } from "../api/endpoints";
import type { Goal, RacePlanOut } from "../api/types";
import { writeClipboard } from "../app/export";
import { formatDay, formatDuration, formatKm, formatMeters, isoDate, todayIso } from "../app/format";
import { useToast } from "../app/toasts";
import {
  buildAgenda,
  carbsPerHour,
  clock,
  elapsedMinutes,
  fcLabel,
  rangeLabel,
  raceMarkdown,
  relativeDay,
  totalsOf,
  zoneNumber,
  type AgendaGroup,
  type AgendaItem,
  type AgendaKind,
} from "../race/logic";
import { RaceImportDialog } from "../race/RaceImportDialog";
import type { RacePlanDoc, Tranche } from "../race/types";
import { ProfileChart, ProfileEditor } from "../widgets/RaceGoalWidget";
import { daysUntil } from "./CoursesPage";

const SELECTED_KEY = "coach-trail:course-selected";

function readSelected(): number | null {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

/** Course à afficher par défaut : la prochaine à venir, sinon la plus récente. */
export function defaultGoal(goals: Goal[], today: string = todayIso()): Goal | undefined {
  const sorted = [...goals].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.find((g) => g.date >= today) ?? sorted[sorted.length - 1];
}

/**
 * Cases cochées d'une course, enregistrées sur le serveur : le téléphone et l'ordinateur voient les
 * mêmes. Chaque appareil n'envoie que sa modification ; le plan est relu toutes les 20 s.
 */
function useChecks(goalId: number, serverChecks: string[]): { done: Set<string>; toggle: (key: string) => void; reset: () => void } {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const queryKey = ["race-plan", goalId];
  const apply = (checks: string[]) => {
    queryClient.setQueryData<RacePlanOut | null>(queryKey, (old) => (old ? { ...old, checks } : old));
  };
  const toggleMutation = useMutation({
    mutationFn: ({ key, done }: { key: string; done: boolean }) => setRaceCheck(goalId, key, done),
    onMutate: ({ key, done }) => {
      const old = queryClient.getQueryData<RacePlanOut | null>(queryKey)?.checks ?? [];
      apply(done ? [...old.filter((k) => k !== key), key] : old.filter((k) => k !== key));
    },
    onSuccess: apply,
    onError: (error: Error) => {
      notify(`Case non enregistrée : ${error.message}`, "error");
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const resetMutation = useMutation({
    mutationFn: () => clearRaceChecks(goalId),
    onSuccess: apply,
    onError: (error: Error) => { notify(error.message, "error"); },
  });
  const done = useMemo(() => new Set(serverChecks), [serverChecks]);
  return {
    done,
    toggle: (key) => { toggleMutation.mutate({ key, done: !done.has(key) }); },
    reset: () => { resetMutation.mutate(); },
  };
}

function useNow(everyMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => { setNow(new Date()); }, everyMs);
    return () => { clearInterval(id); };
  }, [everyMs]);
  return now;
}

const ICONS: Record<AgendaKind, string> = {
  activite: "🏃",
  repas: "🍝",
  hydratation: "💧",
  sommeil: "😴",
  note: "•",
  echauffement: "🔥",
  reveil: "⏰",
  depart: "🏁",
};

const hhmm = (d: Date): string => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// --- bandeau du haut ----------------------------------------------------------------------------

function Hero({ goal, doc, next, total, doneCount, now }: { goal: Goal; doc: RacePlanDoc; next: AgendaItem | null; total: number; doneCount: number; now: Date }) {
  const days = daysUntil(goal.date, isoDate(now));
  const tot = totalsOf(doc.tranches ?? []);
  const o = doc.objectif;
  const start = elapsedMinutes(goal.date, doc.matin?.depart, now);
  const countdown = (() => {
    if (start !== null && start >= 0 && start <= Math.max(tot.minutes, 1)) return `En course · ${clock(start)}`;
    if (start !== null && start < 0 && days <= 1) {
      const left = Math.round(-start);
      return left >= 120 ? `Départ dans ${Math.floor(left / 60)} h ${String(left % 60).padStart(2, "0")}` : `Départ dans ${left} min`;
    }
    if (days === 0) return "Jour de course";
    return days > 0 ? `J−${days}` : `Terminée il y a ${-days} j`;
  })();
  const chips: [string, string][] = [];
  if (o?.temps_cible_min !== undefined) chips.push(["Objectif", formatDuration(o.temps_cible_min)]);
  if (o?.allure_cible) chips.push(["Allure", o.allure_cible]);
  if (tot.carbs) chips.push(["Glucides", `${tot.carbs} g`]);
  if (tot.gels) chips.push(["Gels", String(tot.gels)]);
  if (tot.drinkMl) chips.push(["Boisson", `${(tot.drinkMl / 1000).toFixed(1).replace(".", ",")} L`]);
  if (tot.sodiumMg) chips.push(["Sodium", `${tot.sodiumMg} mg`]);
  return (
    <div className="race-hero">
      <div className="race-countdown">{countdown}</div>
      <div className="race-chips-row">
        {chips.map(([label, value]) => (
          <div key={label} className="race-kpi">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="race-progress" title="Cases cochées">
        <span>{doneCount} / {total}</span>
        <progress max={Math.max(total, 1)} value={doneCount} />
      </div>
      {o?.strategie && <p className="race-strategy">{o.strategie}</p>}
      {next && (
        <p className="race-next">
          <span className="race-next-tag">Prochaine étape</span>
          <span aria-hidden="true">{ICONS[next.kind]}</span> {next.time && <strong>{next.time} </strong>}
          {next.text}
          {next.extra && <span className="muted"> · {next.extra}</span>}
        </p>
      )}
    </div>
  );
}

// --- bande visuelle de la course ----------------------------------------------------------------

function RaceStrip({ doc, elapsed }: { doc: RacePlanDoc; elapsed: number | null }) {
  const slices = [...(doc.tranches ?? [])].sort((a, b) => a.debut_min - b.debut_min);
  if (slices.length === 0) return <p className="muted">Aucune tranche : importez le plan pour voir la course heure par heure.</p>;
  const end = Math.max(...slices.map((t) => t.fin_min));
  const stops = (doc.ravitaillements ?? []).filter((r) => r.temps_estime_min !== undefined && r.temps_estime_min <= end);
  return (
    <div className="race-strip-wrap">
      <div className="race-strip" role="img" aria-label="Course découpée par tranche, colorée selon la zone">
        {slices.map((t, i) => {
          const z = zoneNumber(t.zone);
          const current = elapsed !== null && elapsed >= t.debut_min && elapsed < t.fin_min;
          return (
            <div
              key={i}
              className={`race-block${current ? " race-block-now" : ""}`}
              style={{ flexGrow: t.fin_min - t.debut_min, background: z ? `var(--zone-${z})` : "var(--surface-2)" }}
            >
              <strong>{t.zone ?? "—"}</strong>
              <span>{fcLabel(t) ?? ""}</span>
              <span className="race-block-fuel">
                {t.glucides_g !== undefined && `${t.glucides_g} g`}
                {t.gels ? ` · ${"●".repeat(Math.floor(t.gels))}${t.gels % 1 ? "◐" : ""}` : ""}
              </span>
            </div>
          );
        })}
        {stops.map((r, i) => (
          <span key={i} className="race-stop" style={{ left: `${((r.temps_estime_min ?? 0) / end) * 100}%` }} title={r.action ?? r.nom ?? ""}>
            ▼ km {r.km}
          </span>
        ))}
        {elapsed !== null && elapsed > 0 && elapsed < end && <span className="race-cursor" style={{ left: `${(elapsed / end) * 100}%` }} aria-hidden="true" />}
      </div>
      <div className="race-axis" aria-hidden="true">
        {slices.map((t, i) => (
          <span key={i} style={{ flexGrow: t.fin_min - t.debut_min }}>{clock(t.debut_min)}</span>
        ))}
        <span className="race-axis-end">{clock(end)}</span>
      </div>
      <p className="race-legend muted">● = un gel · couleur = zone d'intensité · ▼ = ravitaillement</p>
    </div>
  );
}

function SlicesTable({ slices, elapsed }: { slices: Tranche[]; elapsed: number | null }) {
  const tot = totalsOf(slices);
  const has = (pick: (t: Tranche) => unknown) => slices.some((t) => pick(t) !== undefined);
  const km = has((t) => t.km_debut ?? t.km_fin);
  const pace = has((t) => t.allure);
  const sodium = has((t) => t.sodium_mg);
  const drink = has((t) => t.boisson_ml);
  return (
    <div className="table-scroll">
      <table className="data-table race-table">
        <thead>
          <tr>
            <th scope="col">Temps</th>
            {km && <th scope="col">Km</th>}
            <th scope="col">FC</th>
            {pace && <th scope="col">Allure</th>}
            <th scope="col">Glucides</th>
            <th scope="col">Gels</th>
            {drink && <th scope="col">Boisson</th>}
            {sodium && <th scope="col">Sodium</th>}
            <th scope="col">À faire</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((t, i) => {
            const current = elapsed !== null && elapsed >= t.debut_min && elapsed < t.fin_min;
            return (
              <tr key={i} className={current ? "race-row-now" : undefined}>
                <th scope="row">
                  <span className="race-zone-dot" style={{ background: `var(--zone-${zoneNumber(t.zone) ?? 1})` }} aria-hidden="true" />
                  {rangeLabel(t)}
                </th>
                {km && <td>{t.km_debut ?? "?"}–{t.km_fin ?? "?"}</td>}
                <td>{fcLabel(t) ?? "—"}</td>
                {pace && <td>{t.allure ?? "—"}</td>}
                <td>
                  {t.glucides_g === undefined ? "—" : `${t.glucides_g} g`}
                  {carbsPerHour(t) !== null && t.fin_min - t.debut_min !== 60 && <small className="muted"> ({carbsPerHour(t)} g/h)</small>}
                </td>
                <td>{t.gels ?? "—"}</td>
                {drink && <td>{t.boisson_ml === undefined ? "—" : `${t.boisson_ml} ml`}</td>}
                {sodium && <td>{t.sodium_mg === undefined ? "—" : `${t.sodium_mg} mg`}</td>}
                <td className="race-note">{[t.aliment, t.note].filter(Boolean).join(" — ") || "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Total · {clock(tot.minutes)}</th>
            {km && <td></td>}
            <td></td>
            {pace && <td></td>}
            <td>{tot.carbs} g</td>
            <td>{tot.gels}</td>
            {drink && <td>{tot.drinkMl} ml</td>}
            {sodium && <td>{tot.sodiumMg} mg</td>}
            <td></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// --- feuille de route ---------------------------------------------------------------------------

function Roadmap({
  groups,
  today,
  nowTime,
  done,
  nextKey,
  toggle,
}: {
  groups: AgendaGroup[];
  today: string;
  nowTime: string;
  done: Set<string>;
  nextKey: string | null;
  toggle: (key: string) => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const past = groups.filter((g) => g.date < today);
  const upcoming = groups.filter((g) => g.date >= today);
  const render = (g: AgendaGroup) => {
    const finished = g.items.filter((i) => done.has(i.key)).length;
    return (
      <section key={g.id} className={`road-group${g.date === today ? " road-today" : ""}`}>
        <h3>
          <span>{g.title}</span>
          <span className="road-date">{g.id === "apres" ? "" : relativeDay(g.date, today)}</span>
          <span className="road-count">{finished}/{g.items.length}</span>
        </h3>
        <ul>
          {g.items.map((item) => {
            const isDone = done.has(item.key);
            const late = !isDone && g.date === today && item.time !== null && item.time < nowTime;
            return (
              <li key={item.key} className={`road-item${isDone ? " road-done" : ""}${item.key === nextKey ? " road-next" : ""}${late ? " road-late" : ""}`}>
                <label>
                  <input type="checkbox" checked={isDone} onChange={() => { toggle(item.key); }} />
                  <span className="road-icon" aria-hidden="true">{ICONS[item.kind]}</span>
                  {item.time && <strong className="road-time">{item.time}</strong>}
                  <span className="road-text">
                    {item.text}
                    {item.extra && <small className="muted"> · {item.extra}</small>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>
    );
  };
  return (
    <div className="race-panel road">
      <h2>Feuille de route</h2>
      {past.length > 0 && (
        <button type="button" className="btn btn-small road-past-btn" onClick={() => { setShowPast(!showPast); }} aria-expanded={showPast}>
          {showPast ? "Masquer" : "Afficher"} {past.length} jour(s) passé(s)
        </button>
      )}
      {showPast && past.map(render)}
      {upcoming.map(render)}
      {groups.length === 0 && <p className="muted">Aucune étape dans le plan.</p>}
    </div>
  );
}

function Gear({ items, done, toggle }: { items: string[]; done: Set<string>; toggle: (key: string) => void }) {
  return (
    <section className="race-panel">
      <h2>Matériel · {items.filter((_, i) => done.has(`m:${i}`)).length}/{items.length}</h2>
      <ul className="race-gear">
        {items.map((m, i) => (
          <li key={i} className={done.has(`m:${i}`) ? "road-done" : undefined}>
            <label>
              <input type="checkbox" checked={done.has(`m:${i}`)} onChange={() => { toggle(`m:${i}`); }} />
              <span>{m}</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlanView({ doc, goal, serverChecks }: { doc: RacePlanDoc; goal: Goal; serverChecks: string[] }) {
  const now = useNow();
  const today = isoDate(now);
  const { done, toggle, reset } = useChecks(goal.id, serverChecks);
  const profile = useQuery({ queryKey: ["race-goal", goal.id], queryFn: () => fetchRaceGoal(goal.id), retry: false });
  const groups = useMemo(() => buildAgenda(goal.date, doc), [goal.date, doc]);
  const nowTime = hhmm(now);
  const live = groups.filter((g) => g.date >= today);
  const next = live.flatMap((g) => g.items).find((i) => !done.has(i.key)) ?? null;
  const all = groups.flatMap((g) => g.items);
  const gear = doc.materiel ?? [];
  const total = all.length + gear.length;
  const doneCount = all.filter((i) => done.has(i.key)).length + gear.filter((_, i) => done.has(`m:${i}`)).length;
  const elapsed = elapsedMinutes(goal.date, doc.matin?.depart, now);
  const slices = [...(doc.tranches ?? [])].sort((a, b) => a.debut_min - b.debut_min);
  const stops = doc.ravitaillements ?? [];
  const notes = doc.notes ?? [];

  return (
    <>
      <Hero goal={goal} doc={doc} next={next} total={total} doneCount={doneCount} now={now} />
      <div className="race-grid">
        <div className="race-col">
          <section className="race-panel">
            <h2>La course</h2>
            <RaceStrip doc={doc} elapsed={elapsed} />
            {slices.length > 0 && <SlicesTable slices={slices} elapsed={elapsed} />}
          </section>
          {gear.length > 0 && <Gear items={gear} done={done} toggle={toggle} />}
          {stops.length > 0 && (
            <section className="race-panel">
              <h2>Ravitaillements</h2>
              <ul className="race-stops">
                {stops.map((r, i) => (
                  <li key={i}>
                    <strong>km {r.km}</strong>
                    {r.temps_estime_min !== undefined && <span className="race-stop-time">{clock(r.temps_estime_min)}</span>}
                    <span>{[r.nom, r.action].filter(Boolean).join(" — ")}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {profile.data && (
            <details className="race-panel race-profile" open={profile.data.profile !== null}>
              <summary>Profil altimétrique</summary>
              {profile.data.profile ? <ProfileChart profile={profile.data.profile} /> : <p className="muted">Profil non renseigné.</p>}
              <ProfileEditor report={profile.data} />
            </details>
          )}
          {notes.length > 0 && (
            <details className="race-panel">
              <summary>Notes ({notes.length})</summary>
              <ul className="race-list">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
            </details>
          )}
        </div>
        <div className="race-col">
          <Roadmap groups={groups} today={today} nowTime={nowTime} done={done} nextKey={next?.key ?? null} toggle={toggle} />
          {done.size > 0 && (
            <button type="button" className="btn btn-small" onClick={() => { if (window.confirm("Tout décocher ?")) reset(); }}>
              Tout décocher
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/** Onglet Course : tout le jour J d'une course (feuille de route à cocher, bande de course, nutrition). */
export function CoursePage() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const goals = useQuery({ queryKey: ["goals"], queryFn: fetchGoals });
  const [selectedId, setSelectedId] = useState<number | null>(readSelected);
  const [importing, setImporting] = useState(false);

  const goal = goals.data?.find((g) => g.id === selectedId) ?? (goals.data ? defaultGoal(goals.data) : undefined);
  const plan = useQuery({
    queryKey: ["race-plan", goal?.id],
    queryFn: () => fetchRacePlan(goal?.id ?? 0),
    enabled: goal !== undefined,
    refetchInterval: 20_000,
  });
  const remove = useMutation({
    mutationFn: () => deleteRacePlan(goal?.id ?? 0),
    onSuccess: async () => {
      notify("Plan de course supprimé.");
      await queryClient.invalidateQueries({ queryKey: ["race-plan", goal?.id] });
    },
    onError: (e: Error) => { notify(e.message, "error"); },
  });

  useEffect(() => {
    if (goal === undefined) return;
    try {
      localStorage.setItem(SELECTED_KEY, String(goal.id));
    } catch {
      // stockage indisponible : la course choisie ne sera pas mémorisée
    }
  }, [goal]);

  if (goals.isPending) return <p role="status">Chargement…</p>;
  if (goals.isError) return <p role="alert">Impossible de lire les courses : {goals.error.message}</p>;
  if (!goal) {
    return (
      <section className="course-page">
        <h1 className="race-title">Course</h1>
        <p className="muted">
          Aucune course : ajoutez-en une depuis <Link to="/courses">Plans &amp; courses</Link>.
        </p>
      </section>
    );
  }

  const stats = [goal.distance_km === null ? null : formatKm(goal.distance_km), goal.dplus_m === null ? null : `D+ ${formatMeters(goal.dplus_m)}`]
    .filter(Boolean)
    .join(" · ");
  const doc = plan.data?.data;

  return (
    <section className="course-page">
      <header className="race-head">
        <div className="race-head-main">
          <select aria-label="Course" className="race-select" value={goal.id} onChange={(e) => { setSelectedId(Number(e.target.value)); }}>
            {[...goals.data]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nom} · {formatDay(g.date)}
                </option>
              ))}
          </select>
          <span className="race-meta">{[formatDay(goal.date), stats].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="toolbar-actions">
          <button
            type="button"
            className="btn btn-small"
            disabled={!doc}
            onClick={() => {
              if (!doc) return;
              void writeClipboard(raceMarkdown(goal.nom, goal.date, doc)).then((ok) => {
                notify(ok ? "Plan de course copié pour Claude." : "Copie impossible.", ok ? "info" : "error");
              });
            }}
          >
            Exporter
          </button>
          <button type="button" className="btn btn-small btn-primary" onClick={() => { setImporting(true); }}>
            Importer
          </button>
          {doc && (
            <button type="button" className="btn btn-small" onClick={() => { if (window.confirm(`Supprimer le plan de course de « ${goal.nom} » ?`)) remove.mutate(); }}>
              Supprimer le plan
            </button>
          )}
        </div>
      </header>

      {plan.isPending && <p role="status">Chargement du plan…</p>}
      {plan.isError && <p role="alert">Impossible de lire le plan : {plan.error.message}</p>}
      {plan.data && plan.data.warnings.length > 0 && <p className="muted">{plan.data.warnings.map((w) => `⚠ ${w}`).join(" ")}</p>}
      {plan.isSuccess && !doc && (
        <div className="race-empty">
          <p>Pas encore de plan de course pour « {goal.nom} ».</p>
          <p className="muted">
            Cliquez sur Importer : le prompt à donner à Claude (nutrition de la veille et du matin, zones et glucides heure par heure,
            ravitaillements, matériel) est fourni, puis collez sa réponse.
          </p>
        </div>
      )}
      {doc && <PlanView doc={doc} goal={goal} serverChecks={plan.data?.checks ?? []} />}
      {importing && <RaceImportDialog goal={goal} hasPlan={doc !== undefined} onClose={() => { setImporting(false); }} />}
    </section>
  );
}
