import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createPlanSession,
  deletePlanSession,
  fetchPlanWeek,
  setWorkoutType,
  updatePlanSession,
} from "../api/endpoints";
import type {
  ActivityBrief,
  Conformity,
  DetectedWorkout,
  DayPlan,
  PlannedInput,
  PlannedSession,
  PlanStatus,
  SessionMatch,
  SessionType,
  WorkoutType,
} from "../api/types";
import { addDays, formatDay, formatDuration, formatKm, formatMeters, formatSigned, formatNumber } from "../app/format";
import { EvidenceBadge } from "./common";
import { formatWeekPlan } from "./exports";
import { SESSION_TYPE_OPTIONS, sportLabel, STATUS_CLASS } from "./labels";
import { Overlay } from "./Overlay";
import { invalidateTraining, REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData } from "./states";
import { SummaryLayout } from "./summary";

/** `date` : un jour de la semaine voulue (la semaine en cours si absent). */
const useWeekPlan = (date?: string) =>
  useQuery({
    queryKey: ["plan", "week", date ?? "now"],
    queryFn: () => fetchPlanWeek(date),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });

export function StatusChip({ status }: { status: PlanStatus | null }) {
  if (!status) return <span className="chip chip-none">rien de prévu</span>;
  return <span className={`chip chip-${STATUS_CLASS[status]}`}>{status}</span>;
}

export function activityText(a: ActivityBrief): string {
  const parts = [formatDuration(a.duration_min)];
  if (a.distance_km) parts.push(formatKm(a.distance_km));
  if (a.dplus_m) parts.push(`D+ ${formatMeters(a.dplus_m)}`);
  return `${sportLabel(a.sport)} · ${parts.join(" · ")}`;
}

export function plannedText(p: PlannedSession): string {
  const parts: string[] = [];
  if (p.duree_min) parts.push(formatDuration(p.duree_min));
  if (p.zone_cible) parts.push(`zone ${p.zone_cible}`);
  if (p.dplus_cible) parts.push(`D+ ${formatMeters(p.dplus_cible)}`);
  return parts.join(" · ");
}

export function gapText(m: SessionMatch): string | null {
  if (!m.activity) return null;
  const parts: string[] = [];
  if (m.duration_delta_min !== null) parts.push(`${formatSigned(m.duration_delta_min, 0, "min")} vs prévu`);
  if (m.dplus_delta_m !== null) parts.push(`D+ ${formatSigned(m.dplus_delta_m, 0, "m")}`);
  return parts.length ? parts.join(" · ") : null;
}

const WORKOUT_OPTIONS: { value: WorkoutType; label: string }[] = [
  { value: "footing", label: "Footing" },
  { value: "longue", label: "Sortie longue" },
  { value: "seuil", label: "Seuil" },
  { value: "fractionne", label: "Fractionné" },
  { value: "cotes", label: "Côtes" },
  { value: "course", label: "Course" },
];

const CONFORMITY_CHIP: Record<Conformity, { text: string; cls: string }> = {
  atteint: { text: "objectif atteint", cls: "done" },
  partiel: { text: "objectif partiel", cls: "partial" },
  ecart: { text: "couru, hors objectif", cls: "missed" },
};

export function ConformityChip({ conformity, reason }: { conformity: Conformity | null | undefined; reason?: string | null }) {
  if (!conformity) return null;
  const chip = CONFORMITY_CHIP[conformity];
  return (
    <span className={`chip chip-${chip.cls}`} title={reason ?? undefined}>
      {chip.text}
    </span>
  );
}

/** Type de la sortie réalisée : calculé d'après la FC (hypothèse), corrigeable à la main. */
function WorkoutLine({ activityId, workout }: { activityId: number; workout: DetectedWorkout }) {
  const queryClient = useQueryClient();
  const change = useMutation({
    mutationFn: (type: WorkoutType | null) => setWorkoutType(activityId, type),
    onSettled: () => invalidateTraining(queryClient),
  });
  return (
    <div className="plan-workout">
      <label>
        <span className="muted">
          {workout.source === "manuel" ? "Type choisi" : `Type détecté (confiance ${workout.confidence})`}
        </span>
        <select
          aria-label="Type de la séance réalisée"
          value={workout.type}
          disabled={change.isPending}
          onChange={(event) => { change.mutate(event.target.value as WorkoutType); }}
        >
          {WORKOUT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      {workout.source === "manuel" && (
        <button type="button" className="btn btn-small" onClick={() => { change.mutate(null); }}>
          Recalculer
        </button>
      )}
      {workout.reasons[0] && <span className="muted plan-workout-why">{workout.reasons[0]}</span>}
      {change.isError && <span className="form-error" role="alert">{change.error.message}</span>}
    </div>
  );
}

const DRAG_TYPE = "application/x-coach-trail-session";

function SessionRow({
  match,
  onEdit,
  onDragStateChange,
}: {
  match: SessionMatch;
  onEdit: (p: PlannedSession) => void;
  onDragStateChange: (planned: PlannedSession | null) => void;
}) {
  const { planned, activity } = match;
  const gap = gapText(match);
  return (
    <div
      className="plan-session plan-session-draggable"
      draggable
      title="Glisser vers un autre jour pour décaler la séance"
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, String(planned.id));
        event.dataTransfer.setData("text/plain", planned.titre);
        event.dataTransfer.effectAllowed = "move";
        onDragStateChange(planned);
      }}
      onDragEnd={() => { onDragStateChange(null); }}
    >
      <button type="button" className="plan-planned" onClick={() => { onEdit(planned); }}>
        <strong>{planned.titre}</strong>
        <span className="muted">
          {planned.type_label}
          {plannedText(planned) && ` · ${plannedText(planned)}`}
        </span>
      </button>
      <div className="plan-done">
        {activity ? (
          <>
            <span>{activityText(activity)}</span>
            {gap && <span className="muted">{gap}</span>}
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </div>
      <div className="plan-chips">
        <StatusChip status={match.status} />
        <ConformityChip conformity={match.conformity} reason={match.conformity_reason} />
      </div>
      {activity?.workout && <WorkoutLine activityId={activity.id} workout={activity.workout} />}
      {match.conformity_reason && match.conformity === "ecart" && (
        <p className="plan-conformity-note">{match.conformity_reason}</p>
      )}
    </div>
  );
}

function DayBlock({
  day,
  onEdit,
  onAdd,
  highlighted,
  dragging,
  onDragStateChange,
  onMove,
}: {
  day: DayPlan;
  onEdit: (p: PlannedSession) => void;
  onAdd: (date: string) => void;
  highlighted?: boolean;
  /** Séance en cours de glisser (null : aucune). */
  dragging: PlannedSession | null;
  onDragStateChange: (planned: PlannedSession | null) => void;
  onMove: (planned: PlannedSession, date: string) => void;
}) {
  const [over, setOver] = useState(false);
  const accepts = dragging !== null && dragging.date !== day.date;
  return (
    <section
      className={`plan-day${highlighted ? " plan-day-today" : ""}${accepts ? " plan-day-droppable" : ""}${over && accepts ? " plan-day-over" : ""}`}
      aria-label={day.weekday}
      onDragOver={(event) => {
        if (!accepts) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (dragging && accepts) onMove(dragging, day.date);
        onDragStateChange(null);
      }}
    >
      <header>
        <h3>
          {highlighted && <span className="plan-today-tag">Aujourd'hui · </span>}
          <span className="plan-weekday">{day.weekday}</span> <span className="muted">{formatDay(day.date)}</span>
        </h3>
        <StatusChip status={day.sessions.length === 0 && !day.status ? null : day.status} />
        <button
          type="button"
          className="icon-btn"
          aria-label={`Ajouter une séance le ${day.weekday} ${formatDay(day.date)}`}
          title="Ajouter une séance"
          onClick={() => { onAdd(day.date); }}
        >
          +
        </button>
      </header>
      {day.sessions.map((m) => (
        <SessionRow key={m.planned.id} match={m} onEdit={onEdit} onDragStateChange={onDragStateChange} />
      ))}
      {day.unplanned_activities.map((a) => (
        <div className="plan-session" key={a.id}>
          <span className="plan-planned muted">Sortie non prévue</span>
          <div className="plan-done">{activityText(a)}</div>
          <StatusChip status="imprévu" />
          {a.workout && <WorkoutLine activityId={a.id} workout={a.workout} />}
        </div>
      ))}
      {highlighted && day.sessions.some((s) => s.planned.consignes) && (
        <ul className="plan-notes">
          {day.sessions
            .filter((s) => s.planned.consignes)
            .map((s) => (
              <li key={s.planned.id}>
                <strong>{s.planned.titre} :</strong> {s.planned.consignes}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}

function WeekNav({ start, current, onGo }: { start: string; current: boolean; onGo: (date: string | undefined) => void }) {
  return (
    <div className="week-nav" role="group" aria-label="Navigation de semaine">
      <button type="button" className="btn btn-small" aria-label="Semaine précédente" onClick={() => { onGo(addDays(start, -7)); }}>
        ←
      </button>
      <button type="button" className="btn btn-small" disabled={current} onClick={() => { onGo(undefined); }}>
        Aujourd'hui
      </button>
      <button type="button" className="btn btn-small" aria-label="Semaine suivante" onClick={() => { onGo(addDays(start, 7)); }}>
        →
      </button>
    </div>
  );
}

export function WeekPlanWidget() {
  const [weekDate, setWeekDate] = useState<string | undefined>(undefined);
  const query = useWeekPlan(weekDate);
  const [editing, setEditing] = useState<PlannedSession | { date: string } | null>(null);
  const [dragging, setDragging] = useState<PlannedSession | null>(null);
  const queryClient = useQueryClient();
  const move = useMutation({
    mutationFn: ({ planned, date }: { planned: PlannedSession; date: string }) =>
      updatePlanSession(planned.id, {
        date,
        titre: planned.titre,
        type: planned.type,
        objectif: planned.objectif,
        duree_min: planned.duree_min,
        zone_cible: planned.zone_cible,
        dplus_cible: planned.dplus_cible,
        consignes: planned.consignes,
      }),
    onSettled: () => invalidateTraining(queryClient),
  });
  return (
    <>
      {move.isError && (
        <p className="form-error" role="alert">
          Le déplacement a échoué : {move.error.message}
        </p>
      )}
      {query.data && <WeekNav start={query.data.week_start} current={weekDate === undefined} onGo={setWeekDate} />}
      <WidgetData
        query={query}
        isEmpty={(w) => w.days.every((d) => d.sessions.length === 0 && d.unplanned_activities.length === 0)}
        emptyMessage="Aucune séance prévue ni réalisée cette semaine."
      >
        {(week) => {
          return (
            <div className="plan">
              <p className="plan-summary">
                Semaine du {formatDay(week.week_start)} au {formatDay(week.week_end)} · prévu{" "}
                <strong>{formatDuration(week.planned_min)}</strong> · réalisé{" "}
                <strong>{formatDuration(week.done_min)}</strong>
              </p>
              <div className="plan-days">
              {week.days.map((d) => (
                <DayBlock
                  key={d.date}
                  day={d}
                  highlighted={d.is_today}
                  onEdit={setEditing}
                  onAdd={(date) => { setEditing({ date }); }}
                  dragging={dragging}
                  onDragStateChange={setDragging}
                  onMove={(planned, date) => { move.mutate({ planned, date }); }}
                />
              ))}
              </div>
              <p className="evidence-note">
                <EvidenceBadge evidence={{ level: "etabli", summary: "Rapprochement par date locale et sport compatible ; « partiel » sous 80 % de la durée prévue." }} />{" "}
                Descriptions uniquement : rien n'est envoyé à la montre.
              </p>
            </div>
          );
        }}
      </WidgetData>
      {query.data?.days.every((d) => d.sessions.length === 0 && d.unplanned_activities.length === 0) && (
        <div className="widget-actions-row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { setEditing({ date: query.data.days.find((d) => d.is_today)?.date ?? query.data.week_start }); }}
          >
            + Ajouter une séance
          </button>
        </div>
      )}
      {editing && (
        <SessionDialog
          session={"id" in editing ? editing : null}
          defaultDate={editing.date}
          onClose={() => { setEditing(null); }}
        />
      )}
    </>
  );
}

function toInput(form: FormData, date: string): PlannedInput {
  const text = (name: string): string | null => {
    const v = form.get(name);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const num = (name: string): number | null => {
    const v = text(name);
    return v === null ? null : Number(v);
  };
  return {
    date: text("date") ?? date,
    titre: text("titre") ?? "",
    type: (text("type") ?? "footing") as SessionType,
    objectif: text("objectif"),
    duree_min: num("duree_min"),
    zone_cible: text("zone_cible"),
    dplus_cible: num("dplus_cible"),
    consignes: text("consignes"),
  };
}

/** Création / édition d'une séance prévue (descriptions uniquement, rien n'est envoyé à la montre). */
export function SessionDialog({
  session,
  defaultDate,
  onClose,
}: {
  session: PlannedSession | null;
  defaultDate: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const done = async () => {
    await invalidateTraining(queryClient);
    onClose();
  };
  const save = useMutation({
    mutationFn: (body: PlannedInput) => (session ? updatePlanSession(session.id, body) : createPlanSession(body)),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: () => deletePlanSession(session?.id ?? 0),
    onSuccess: done,
  });
  const error = save.error ?? remove.error;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate(toInput(new FormData(event.currentTarget), defaultDate));
  };

  return (
    <Overlay onClose={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={session ? "Modifier la séance" : "Nouvelle séance"}
        onClick={(event) => { event.stopPropagation(); }}
        onSubmit={submit}
      >
        <div className="dialog-head">
          <h2>{session ? "Modifier la séance" : "Nouvelle séance"}</h2>
          <button type="button" className="btn btn-small" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="form-grid">
          <label>
            Titre
            <input ref={firstRef} name="titre" required maxLength={120} defaultValue={session?.titre ?? ""} />
          </label>
          <label>
            Type
            <select name="type" defaultValue={session?.type ?? "footing"}>
              {SESSION_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input name="date" type="date" required defaultValue={session?.date ?? defaultDate} />
          </label>
          <label>
            Durée (min)
            <input name="duree_min" type="number" min={1} max={1440} defaultValue={session?.duree_min ?? ""} />
          </label>
          <label>
            Zone cible (ex. 2 ou 1-2)
            <input name="zone_cible" pattern="[1-5](-[1-5])?" defaultValue={session?.zone_cible ?? ""} />
          </label>
          <label>
            D+ cible (m)
            <input name="dplus_cible" type="number" min={0} max={10000} defaultValue={session?.dplus_cible ?? ""} />
          </label>
          <label className="span-2">
            Objectif
            <input name="objectif" maxLength={500} defaultValue={session?.objectif ?? ""} />
          </label>
          <label className="span-2">
            Consignes
            <textarea name="consignes" rows={3} maxLength={2000} defaultValue={session?.consignes ?? ""} />
          </label>
        </div>
        {error && <p role="alert" className="form-error">{error.message}</p>}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={save.isPending}>
            {save.isPending ? "Enregistrement…" : "Enregistrer"}
          </button>
          {session && (
            <button
              type="button"
              className="btn"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(`Supprimer la séance « ${session.titre} » ?`)) remove.mutate();
              }}
            >
              Supprimer
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
        </div>
      </form>
    </Overlay>
  );
}

export function WeekPlanSummary() {
  const query = useWeekPlan();
  return (
    <WidgetData query={query}>
      {(week) => {
        const today = week.days.find((d) => d.is_today);
        const ratio = week.planned_min > 0 ? Math.min(100, (week.done_min / week.planned_min) * 100) : 0;
        return (
          <SummaryLayout
            value={formatDuration(week.done_min)}
            unit={`sur ${formatDuration(week.planned_min)} prévues`}
          >
            <span className="summary-bar"><span style={{ width: `${formatNumber(ratio)}%` }} /></span>
            <ul className="summary-list">
              {today && today.sessions.length > 0 ? (
                today.sessions.map((s) => (
                  <li key={s.planned.id}>
                    <span>{s.planned.titre}</span>
                    <span className="muted">{s.status}</span>
                  </li>
                ))
              ) : (
                <li><span className="muted">Rien de prévu aujourd'hui</span></li>
              )}
            </ul>
          </SummaryLayout>
        );
      }}
    </WidgetData>
  );
}

registerWidget({
  id: "week-plan",
  title: "Programme de la semaine",
  description: "La séance du jour, les 7 jours avec leur statut, et le réalisé à côté du prévu.",
  defaultSize: { w: 12, h: 3 },
  minSize: { w: 3, h: 3 },
  defaultSettings: {},
  settingsSchema: [],
  Component: WeekPlanWidget,
  Summary: WeekPlanSummary,
  exportData: async () => ({ title: "Programme de la semaine", markdown: formatWeekPlan(await fetchPlanWeek()) }),
});
