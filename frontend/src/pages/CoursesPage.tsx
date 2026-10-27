import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import {
  createGoal,
  deleteGoal,
  deletePlan,
  fetchGoals,
  fetchPlans,
  fetchRaceGoal,
  setPlanCourse,
  updateGoal,
  type GoalInput,
} from "../api/endpoints";
import type { Goal, Plan } from "../api/types";
import { formatDay, formatKm, formatMeters, todayIso } from "../app/format";
import { useToast } from "../app/toasts";
import { RaceGoalView } from "../widgets/RaceGoalWidget";
import { WidgetData } from "../widgets/states";

const DAY_MS = 86_400_000;

/** Jours entre aujourd'hui et `iso` (négatif si passé), sans effet de fuseau ni d'heure d'été. */
export function daysUntil(iso: string, today: string = todayIso()): number {
  const utc = (s: string) => {
    const [y = 0, m = 1, d = 1] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(iso) - utc(today)) / DAY_MS);
}

function countdown(days: number): string {
  if (days === 0) return "aujourd'hui";
  return days > 0 ? `J−${days}` : `il y a ${-days} j`;
}

const period = (plan: Plan): string => `${formatDay(plan.date_debut)} → ${formatDay(plan.date_fin)}`;

/** Page Courses : les courses prévues, le plan attribué à chacune, et les plans sans course. */
export function CoursesPage() {
  const queryClient = useQueryClient();
  const { notify } = useToast();
  const goals = useQuery({ queryKey: ["goals"], queryFn: fetchGoals });
  const plans = useQuery({ queryKey: ["plans"], queryFn: fetchPlans });
  const [adding, setAdding] = useState(false);

  const refresh = async () => {
    await Promise.all(
      ["goals", "plans", "race-goal", "plan"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
    );
  };
  const fail = (error: Error) => { notify(error.message, "error"); };

  const attach = useMutation({
    mutationFn: ({ planId, goalId }: { planId: number; goalId: number | null }) => setPlanCourse(planId, goalId),
    onSuccess: async (plan) => {
      notify(plan.goal_nom ? `« ${plan.nom} » attribué à ${plan.goal_nom}.` : `« ${plan.nom} » détaché de sa course.`);
      await refresh();
    },
    onError: fail,
  });
  const removePlan = useMutation({
    mutationFn: (plan: Plan) => deletePlan(plan.id),
    onSuccess: async ({ removed, kept }) => {
      notify(`Plan supprimé (${removed} séance(s))${kept ? `, ${kept} séance(s) réalisée(s) conservée(s)` : ""}.`);
      await refresh();
    },
    onError: fail,
  });
  const removeGoal = useMutation({
    mutationFn: (goal: Goal) => deleteGoal(goal.id),
    onSuccess: async () => {
      notify("Course supprimée.");
      await refresh();
    },
    onError: fail,
  });
  const save = useMutation({
    mutationFn: ({ id, body }: { id: number | null; body: GoalInput }) => (id === null ? createGoal(body) : updateGoal(id, body)),
    onSuccess: async (_goal, { id }) => {
      notify(id === null ? "Course ajoutée." : "Course modifiée.");
      setAdding(false);
      await refresh();
    },
    onError: fail,
  });

  const confirmDeletePlan = (plan: Plan) => {
    if (window.confirm(`Supprimer le plan « ${plan.nom} » et ses ${plan.nb_seances} séance(s) ? Les séances déjà réalisées sont conservées.`)) {
      removePlan.mutate(plan);
    }
  };
  const confirmDeleteGoal = (goal: Goal) => {
    if (window.confirm(`Supprimer la course « ${goal.nom} » ? Ses plans sont conservés, sans course.`)) removeGoal.mutate(goal);
  };

  const today = todayIso();
  const sorted = [...(goals.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter((g) => g.date >= today);
  const past = sorted.filter((g) => g.date < today).reverse();
  const allPlans = plans.data ?? [];
  const unattached = allPlans.filter((p) => p.goal_id === null);

  const card = (goal: Goal) => (
    <CourseCard
      key={goal.id}
      goal={goal}
      plans={allPlans}
      busy={attach.isPending || removePlan.isPending || save.isPending}
      onAttach={(planId) => { attach.mutate({ planId, goalId: goal.id }); }}
      onDetach={(planId) => { attach.mutate({ planId, goalId: null }); }}
      onDeletePlan={confirmDeletePlan}
      onSave={(body) => { save.mutate({ id: goal.id, body }); }}
      onDelete={() => { confirmDeleteGoal(goal); }}
    />
  );

  return (
    <section className="courses-page">
      <div className="toolbar">
        <h1>Courses</h1>
        <div className="toolbar-actions">
          <button type="button" className="btn btn-primary" onClick={() => { setAdding(!adding); }}>
            {adding ? "Annuler" : "+ Ajouter une course"}
          </button>
        </div>
      </div>
      <p className="hint">
        Chaque course peut avoir son plan. Importez le plan de la course suivante dès qu'il est validé : il ne remplace
        jamais un autre plan sans votre confirmation.
      </p>
      {adding && (
        <GoalForm
          title="Nouvelle course"
          pending={save.isPending}
          onSubmit={(body) => { save.mutate({ id: null, body }); }}
          onCancel={() => { setAdding(false); }}
        />
      )}
      {goals.isPending && <p role="status">Chargement…</p>}
      {goals.isError && <p role="alert">Impossible de lire les courses : {goals.error.message}</p>}
      {goals.data && sorted.length === 0 && !adding && (
        <p className="muted">Aucune course : ajoutez-en une (nom, date, distance, D+), ou importez un plan qui la nomme.</p>
      )}
      <div className="course-list">{upcoming.map(card)}</div>

      {unattached.length > 0 && (
        <>
          <h2 className="sub">Plans sans course</h2>
          <ul className="plan-list">
            {unattached.map((plan) => (
              <li key={plan.id}>
                <PlanLine plan={plan} />
                <AttachSelect
                  goals={sorted}
                  disabled={attach.isPending}
                  onPick={(goalId) => { attach.mutate({ planId: plan.id, goalId }); }}
                />
                <button type="button" className="btn btn-small" onClick={() => { confirmDeletePlan(plan); }}>
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {past.length > 0 && (
        <>
          <h2 className="sub">Courses passées</h2>
          <div className="course-list course-past">{past.map(card)}</div>
        </>
      )}
    </section>
  );
}

function PlanLine({ plan }: { plan: Plan }) {
  return (
    <span className="plan-line">
      <strong>{plan.nom}</strong> <span className="muted">{period(plan)} · {plan.nb_seances} séance(s)</span>
    </span>
  );
}

function AttachSelect({
  goals,
  disabled,
  onPick,
}: {
  goals: Goal[];
  disabled: boolean;
  onPick: (goalId: number) => void;
}) {
  if (goals.length === 0) return <span className="muted">Ajoutez une course pour y attribuer ce plan.</span>;
  return (
    <select
      aria-label="Attribuer à une course"
      disabled={disabled}
      value=""
      onChange={(event) => {
        if (event.target.value) onPick(Number(event.target.value));
      }}
    >
      <option value="">Attribuer à une course…</option>
      {goals.map((g) => (
        <option key={g.id} value={g.id}>
          {g.nom} · {formatDay(g.date)}
        </option>
      ))}
    </select>
  );
}

function CourseCard(props: {
  goal: Goal;
  plans: Plan[];
  busy: boolean;
  onAttach: (planId: number) => void;
  onDetach: (planId: number) => void;
  onDeletePlan: (plan: Plan) => void;
  onSave: (body: GoalInput) => void;
  onDelete: () => void;
}) {
  const { goal } = props;
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState(false);
  const own = props.plans.filter((p) => p.goal_id === goal.id);
  const others = props.plans.filter((p) => p.goal_id !== goal.id);
  const days = daysUntil(goal.date);
  const stats = [goal.distance_km === null ? null : formatKm(goal.distance_km), goal.dplus_m === null ? null : `D+ ${formatMeters(goal.dplus_m)}`]
    .filter(Boolean)
    .join(" · ");
  const race = useQuery({
    queryKey: ["race-goal", goal.id],
    queryFn: () => fetchRaceGoal(goal.id),
    enabled: details,
    retry: false,
  });

  return (
    <article className="course-card" aria-label={goal.nom}>
      <header className="course-head">
        <div>
          <h2>{goal.nom}</h2>
          <p className="muted">
            {formatDay(goal.date)} · <strong>{countdown(days)}</strong>
            {stats && ` · ${stats}`}
          </p>
        </div>
        <div className="toolbar-actions">
          <button type="button" className="btn btn-small" onClick={() => { setEditing(!editing); }}>
            {editing ? "Fermer" : "Modifier"}
          </button>
          <button type="button" className="btn btn-small" onClick={props.onDelete}>
            Supprimer
          </button>
        </div>
      </header>

      {editing && (
        <GoalForm
          title="Modifier la course"
          initial={goal}
          pending={props.busy}
          onSubmit={(body) => { props.onSave(body); setEditing(false); }}
          onCancel={() => { setEditing(false); }}
        />
      )}

      <h3 className="sub">Plan</h3>
      {own.length === 0 ? (
        <p className="muted">Aucun plan pour cette course.</p>
      ) : (
        <ul className="plan-list">
          {own.map((plan) => (
            <li key={plan.id}>
              <PlanLine plan={plan} />
              <button type="button" className="btn btn-small" disabled={props.busy} onClick={() => { props.onDetach(plan.id); }}>
                Détacher
              </button>
              <button type="button" className="btn btn-small" onClick={() => { props.onDeletePlan(plan); }}>
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <select
          aria-label={`Attribuer un plan à ${goal.nom}`}
          disabled={props.busy}
          value=""
          onChange={(event) => {
            if (event.target.value) props.onAttach(Number(event.target.value));
          }}
        >
          <option value="">Attribuer un plan…</option>
          {others.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nom} · {period(p)}
              {p.goal_nom ? ` (actuellement : ${p.goal_nom})` : ""}
            </option>
          ))}
        </select>
      )}

      <button type="button" className="btn btn-small" aria-expanded={details} onClick={() => { setDetails(!details); }}>
        {details ? "Masquer la préparation" : "Voir la préparation"}
      </button>
      {details && <WidgetData query={race}>{(report) => <RaceGoalView report={report} />}</WidgetData>}
    </article>
  );
}

function GoalForm(props: {
  title: string;
  initial?: Goal;
  pending: boolean;
  onSubmit: (body: GoalInput) => void;
  onCancel: () => void;
}) {
  const { initial } = props;
  const [nom, setNom] = useState(initial?.nom ?? "");
  const [date, setDate] = useState(initial?.date ?? "");
  const [km, setKm] = useState(initial?.distance_km?.toString() ?? "");
  const [dplus, setDplus] = useState(initial?.dplus_m?.toString() ?? "");
  const valid = nom.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(date);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    props.onSubmit({
      nom: nom.trim(),
      date,
      distance_km: km === "" ? null : Number(km),
      dplus_m: dplus === "" ? null : Number(dplus),
      ...(initial ? { priorite: initial.priorite } : {}),
    });
  };
  return (
    <form className="form-grid goal-form" onSubmit={submit} aria-label={props.title}>
      <label className="field">
        <span>Nom</span>
        <input type="text" value={nom} maxLength={200} onChange={(event) => { setNom(event.target.value); }} />
      </label>
      <label className="field">
        <span>Date</span>
        <input type="date" value={date} onChange={(event) => { setDate(event.target.value); }} />
      </label>
      <label className="field">
        <span>Distance (km)</span>
        <input type="number" min="0" step="0.1" value={km} onChange={(event) => { setKm(event.target.value); }} />
      </label>
      <label className="field">
        <span>D+ (m)</span>
        <input type="number" min="0" step="1" value={dplus} onChange={(event) => { setDplus(event.target.value); }} />
      </label>
      <div className="toolbar-actions">
        <button type="submit" className="btn btn-primary" disabled={!valid || props.pending}>
          Enregistrer
        </button>
        <button type="button" className="btn" onClick={props.onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}
