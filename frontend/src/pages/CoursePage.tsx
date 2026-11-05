import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { deleteRacePlan, fetchGoals, fetchRaceGoal, fetchRacePlan } from "../api/endpoints";
import type { Goal } from "../api/types";
import { writeClipboard } from "../app/export";
import { formatDay, formatDuration, formatKm, formatMeters, todayIso } from "../app/format";
import { useToast } from "../app/toasts";
import { carbsPerHour, clock, dayLabel, daysBefore, fcLabel, rangeLabel, raceMarkdown, totalsOf } from "../race/logic";
import { RaceImportDialog } from "../race/RaceImportDialog";
import type { Matin, RacePlanDoc, Repas } from "../race/types";
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

function Panel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`race-panel ${className}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function MealList({ meals }: { meals?: Repas[] }) {
  if (!meals?.length) return null;
  return (
    <ul className="race-list">
      {meals.map((r, i) => (
        <li key={i}>
          {r.heure && <strong>{r.heure} </strong>}
          {r.description}
          {r.glucides_g !== undefined && <span className="muted"> · {r.glucides_g} g glucides</span>}
        </li>
      ))}
    </ul>
  );
}

function Notes({ notes }: { notes?: string[] }) {
  if (!notes?.length) return null;
  return (
    <ul className="race-list">
      {notes.map((n, i) => <li key={i}>{n}</li>)}
    </ul>
  );
}

function MorningPanel({ matin }: { matin: Matin }) {
  return (
    <Panel title="Matin de course">
      <p className="race-times">
        {matin.reveil && <span>Réveil <strong>{matin.reveil}</strong></span>}
        {matin.depart && <span>Départ <strong>{matin.depart}</strong></span>}
      </p>
      <MealList meals={matin.repas} />
      {matin.echauffement && <p><strong>Échauffement :</strong> {matin.echauffement}</p>}
      {matin.hydratation && <p><strong>Hydratation :</strong> {matin.hydratation}</p>}
      <Notes notes={matin.notes} />
    </Panel>
  );
}

function SlicesTable({ doc }: { doc: RacePlanDoc }) {
  const slices = doc.tranches ?? [];
  const tot = totalsOf(slices);
  const has = (pick: (t: (typeof slices)[number]) => unknown) => slices.some((t) => pick(t) !== undefined);
  return (
    <Panel title="Course heure par heure" className="race-slices">
      {slices.length === 0 ? (
        <p className="muted">Aucune tranche : importez le plan pour voir les zones et la nutrition heure par heure.</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table race-table">
            <thead>
              <tr>
                <th scope="col">Temps</th>
                {has((t) => t.km_debut ?? t.km_fin) && <th scope="col">Km</th>}
                <th scope="col">Zone</th>
                <th scope="col">FC</th>
                {has((t) => t.allure) && <th scope="col">Allure</th>}
                <th scope="col">Glucides</th>
                <th scope="col">Gels</th>
                <th scope="col">Boisson</th>
                {has((t) => t.sodium_mg) && <th scope="col">Sodium</th>}
                <th scope="col">À faire</th>
              </tr>
            </thead>
            <tbody>
              {slices.map((t, i) => (
                <tr key={i}>
                  <th scope="row">{rangeLabel(t)}</th>
                  {has((x) => x.km_debut ?? x.km_fin) && <td>{t.km_debut ?? "?"}–{t.km_fin ?? "?"}</td>}
                  <td>{t.zone ?? "—"}</td>
                  <td>{fcLabel(t) ?? "—"}</td>
                  {has((x) => x.allure) && <td>{t.allure ?? "—"}</td>}
                  <td>
                    {t.glucides_g === undefined ? "—" : `${t.glucides_g} g`}
                    {carbsPerHour(t) !== null && (t.fin_min - t.debut_min) !== 60 && <small className="muted"> ({carbsPerHour(t)} g/h)</small>}
                  </td>
                  <td>{t.gels ?? "—"}</td>
                  <td>{t.boisson_ml === undefined ? "—" : `${t.boisson_ml} ml`}</td>
                  {has((x) => x.sodium_mg) && <td>{t.sodium_mg === undefined ? "—" : `${t.sodium_mg} mg`}</td>}
                  <td>{[t.aliment, t.note].filter(Boolean).join(" — ") || "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total · {clock(tot.minutes)}</th>
                {has((t) => t.km_debut ?? t.km_fin) && <td></td>}
                <td></td>
                <td></td>
                {has((t) => t.allure) && <td></td>}
                <td>{tot.carbs} g</td>
                <td>{tot.gels}</td>
                <td>{tot.drinkMl} ml</td>
                {has((t) => t.sodium_mg) && <td>{tot.sodiumMg} mg</td>}
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}

function PlanView({ doc, goal }: { doc: RacePlanDoc; goal: Goal }) {
  const days = daysBefore(doc);
  const o = doc.objectif;
  const profile = useQuery({ queryKey: ["race-goal", goal.id], queryFn: () => fetchRaceGoal(goal.id), retry: false });
  return (
    <div className="race-grid">
      <div className="race-col">
        {(o || profile.data) && (
          <Panel title="Objectif">
            <p className="race-times">
              {o?.temps_cible_min !== undefined && <span>Temps cible <strong>{formatDuration(o.temps_cible_min)}</strong></span>}
              {o?.allure_cible && <span>Allure <strong>{o.allure_cible}</strong></span>}
            </p>
            {o?.strategie && <p>{o.strategie}</p>}
            {profile.data &&
              (profile.data.profile ? <ProfileChart profile={profile.data.profile} /> : <p className="muted">Profil altimétrique non renseigné.</p>)}
            {profile.data && <ProfileEditor report={profile.data} />}
          </Panel>
        )}
        <SlicesTable doc={doc} />
      </div>
      <div className="race-col">
        {days.map((d) => (
          <Panel key={d.jour} title={dayLabel(d)}>
            {d.activite && <p><strong>Activité :</strong> {d.activite}</p>}
            <MealList meals={d.repas} />
            {d.hydratation && <p><strong>Hydratation :</strong> {d.hydratation}</p>}
            {d.sommeil && <p><strong>Sommeil :</strong> {d.sommeil}</p>}
            <Notes notes={d.notes} />
          </Panel>
        ))}
        {doc.matin && <MorningPanel matin={doc.matin} />}
        {doc.ravitaillements && doc.ravitaillements.length > 0 && (
          <Panel title="Ravitaillements">
            <ul className="race-list">
              {doc.ravitaillements.map((r, i) => (
                <li key={i}>
                  <strong>km {r.km}</strong>
                  {r.nom && ` · ${r.nom}`}
                  {r.temps_estime_min !== undefined && <span className="muted"> · vers {clock(r.temps_estime_min)}</span>}
                  {r.action && ` — ${r.action}`}
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {doc.materiel && doc.materiel.length > 0 && (
          <Panel title="Matériel">
            <ul className="race-chips">{doc.materiel.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </Panel>
        )}
        {doc.apres_course && (
          <Panel title="Après la course">
            <MealList meals={doc.apres_course.repas} />
            <Notes notes={doc.apres_course.notes} />
          </Panel>
        )}
        {doc.notes && doc.notes.length > 0 && (
          <Panel title="Notes">
            <Notes notes={doc.notes} />
          </Panel>
        )}
      </div>
    </div>
  );
}

/** Onglet Course : tout le jour J d'une course sur une page (plan, zones, nutrition, veille, matin). */
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

  const days = daysUntil(goal.date);
  const stats = [goal.distance_km === null ? null : formatKm(goal.distance_km), goal.dplus_m === null ? null : `D+ ${formatMeters(goal.dplus_m)}`]
    .filter(Boolean)
    .join(" · ");
  const doc = plan.data?.data;

  return (
    <section className="course-page">
      <header className="race-head">
        <div className="race-head-main">
          <select
            aria-label="Course"
            className="race-select"
            value={goal.id}
            onChange={(e) => { setSelectedId(Number(e.target.value)); }}
          >
            {[...goals.data]
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nom} · {formatDay(g.date)}
                </option>
              ))}
          </select>
          <span className="race-meta">
            <strong>{days === 0 ? "aujourd'hui" : days > 0 ? `J−${days}` : `il y a ${-days} j`}</strong>
            {stats && ` · ${stats}`}
          </span>
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
            <button
              type="button"
              className="btn btn-small"
              onClick={() => { if (window.confirm(`Supprimer le plan de course de « ${goal.nom} » ?`)) remove.mutate(); }}
            >
              Supprimer le plan
            </button>
          )}
        </div>
      </header>

      {plan.isPending && <p role="status">Chargement du plan…</p>}
      {plan.isError && <p role="alert">Impossible de lire le plan : {plan.error.message}</p>}
      {plan.data && plan.data.warnings.length > 0 && (
        <p className="muted">{plan.data.warnings.map((w) => `⚠ ${w}`).join(" ")}</p>
      )}
      {plan.isSuccess && !doc && (
        <div className="race-empty">
          <p>Pas encore de plan de course pour « {goal.nom} ».</p>
          <p className="muted">
            Cliquez sur Importer : le prompt à donner à Claude (nutrition de la veille et du matin, zones et glucides heure par heure,
            ravitaillements, matériel) est fourni, puis collez sa réponse.
          </p>
        </div>
      )}
      {doc && <PlanView doc={doc} goal={goal} />}
      {importing && <RaceImportDialog goal={goal} hasPlan={doc !== undefined} onClose={() => { setImporting(false); }} />}
    </section>
  );
}
