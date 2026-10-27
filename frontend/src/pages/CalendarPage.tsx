import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRef, useState, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { fetchPlanRange } from "../api/endpoints";
import type { DayPlan, RangePlan, SessionMatch } from "../api/types";
import { addDays, formatDay, formatDuration, formatWeekdayDay, todayIso } from "../app/format";
import { EvidenceBadge } from "../widgets/common";
import { REFRESH_MS } from "../widgets/queries";
import { activityText, gapText, plannedText, SessionDialog, StatusChip } from "../widgets/WeekPlanWidget";
import {
  parseDate,
  parseView,
  periodTitle,
  planColor,
  rangeFor,
  shiftDate,
  weekCount,
  NO_PLAN_COLOR,
  type CalendarView,
} from "./calendar";

const DOW = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];

/** Libellé lu par un lecteur d'écran pour un jour : date, séances, réalisé, course. */
function dayLabel(day: DayPlan, races: string[]): string {
  const parts = [formatWeekdayDay(day.date)];
  parts.push(
    day.sessions.length === 0
      ? "rien de prévu"
      : `${day.sessions.length} séance(s) prévue(s) : ${day.sessions.map((s) => `${s.planned.titre} (${s.status})`).join(", ")}`,
  );
  if (day.unplanned_activities.length > 0) parts.push(`${day.unplanned_activities.length} sortie(s) non prévue(s)`);
  if (races.length > 0) parts.push(`course : ${races.join(", ")}`);
  return parts.join(", ");
}

/** Calendrier : semaine ou mois, navigable, un point coloré par séance (couleur du plan). */
export function CalendarPage() {
  const [params, setParams] = useSearchParams();
  const today = todayIso();
  const view = parseView(params.get("vue"));
  const date = parseDate(params.get("date"), today);
  const { from, to } = rangeFor(view, date);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<SessionMatch["planned"] | { date: string } | null>(null);

  const query = useQuery({
    queryKey: ["plan", "range", from, to],
    queryFn: () => fetchPlanRange(from, to),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });

  const go = (nextView: CalendarView, nextDate: string) => {
    setParams({ vue: nextView, date: nextDate }, { replace: true });
    setSelected(null);
  };
  const range: RangePlan | undefined = query.data?.start === from && query.data.end === to ? query.data : undefined;
  const focusDay = selected ?? (from <= today && today <= to ? today : null);
  const detail = range?.days.find((d) => d.date === focusDay) ?? null;

  return (
    <section className="calendar-page">
      <div className="toolbar">
        <h1>Calendrier</h1>
        <div className="toolbar-actions">
          <div className="segmented" role="group" aria-label="Vue">
            {(["semaine", "mois"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={`btn btn-small${view === v ? " btn-primary" : ""}`}
                aria-pressed={view === v}
                onClick={() => { go(v, date); }}
              >
                {v === "semaine" ? "Semaine" : "Mois"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="cal-nav" role="group" aria-label="Navigation">
        <button type="button" className="btn btn-small" aria-label={view === "semaine" ? "Semaine précédente" : "Mois précédent"} onClick={() => { go(view, shiftDate(view, date, -1)); }}>
          ←
        </button>
        <button type="button" className="btn btn-small" onClick={() => { go(view, today); }}>
          Aujourd'hui
        </button>
        <button type="button" className="btn btn-small" aria-label={view === "semaine" ? "Semaine suivante" : "Mois suivant"} onClick={() => { go(view, shiftDate(view, date, 1)); }}>
          →
        </button>
        <h2 className="cal-title" aria-live="polite">{periodTitle(view, date)}</h2>
      </div>

      {query.isError && !query.data && (
        <p role="alert">
          Impossible de lire le calendrier : {query.error.message}{" "}
          <button type="button" className="btn btn-small" onClick={() => void query.refetch()}>Réessayer</button>
        </p>
      )}
      {!query.data && query.isPending && <p role="status">Chargement…</p>}
      {query.data && (
        <>
          <Legend range={query.data} />
          <Grid
            data={query.data}
            from={from}
            view={view}
            monthOf={date.slice(0, 7)}
            today={today}
            selected={focusDay}
            onSelect={setSelected}
          />
        </>
      )}
      {detail && (
        <DayDetail
          day={detail}
          races={range?.races.filter((r) => r.date === detail.date).map((r) => r.nom) ?? []}
          onEdit={setEditing}
        />
      )}
      <p className="evidence-note">
        <EvidenceBadge evidence={{ level: "etabli", summary: "Rapprochement par date locale et sport compatible ; « partiel » sous 80 % de la durée prévue." }} />{" "}
        Descriptions uniquement : rien n'est envoyé à la montre.
      </p>
      {editing && (
        <SessionDialog
          session={"id" in editing ? editing : null}
          defaultDate={editing.date}
          onClose={() => { setEditing(null); }}
        />
      )}
    </section>
  );
}

function Legend({ range }: { range: RangePlan }) {
  if (range.plans.length === 0 && range.races.length === 0) return null;
  return (
    <ul className="cal-legend" aria-label="Légende">
      {range.plans.map((p) => (
        <li key={p.id}>
          <span className="cal-dot" style={{ background: planColor(p.id) }} aria-hidden="true" /> {p.nom}
        </li>
      ))}
      {range.races.map((r) => (
        <li key={r.id}>
          <span className="cal-flag" aria-hidden="true">⚑</span> {r.nom} · {formatDay(r.date)}
        </li>
      ))}
    </ul>
  );
}

function Grid(props: {
  data: RangePlan;
  from: string;
  view: CalendarView;
  monthOf: string;
  today: string;
  selected: string | null;
  onSelect: (day: string) => void;
}) {
  const { data, view } = props;
  const rows = weekCount(data.start, data.end);
  const ref = useRef<HTMLDivElement>(null);
  const focusable = props.selected && data.days.some((d) => d.date === props.selected) ? props.selected : data.days[0]?.date;

  /** Flèches : jour précédent/suivant (←/→), semaine précédente/suivante (↑/↓) ; Entrée sélectionne. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, day: string) => {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const target = addDays(day, step);
    if (target < data.start || target > data.end) return;
    props.onSelect(target);
    requestAnimationFrame(() => { ref.current?.querySelector<HTMLElement>(`[data-day="${target}"]`)?.focus(); });
  };

  return (
    <div ref={ref} className={`cal-grid cal-${view}`} role="grid" aria-label={periodTitle(view, props.monthOf + "-01")} aria-rowcount={rows}>
      <div className="cal-head" role="row">
        {DOW.map((d) => (
          <span key={d} role="columnheader">{d}</span>
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div className="cal-row" role="row" key={r}>
          {data.days.slice(r * 7, r * 7 + 7).map((day, i) => {
            const races = data.races.filter((x) => x.date === day.date);
            const outside = view === "mois" && !day.date.startsWith(props.monthOf);
            const isSelected = props.selected === day.date;
            return (
              <div
                key={day.date}
                role="gridcell"
                data-day={day.date}
                tabIndex={focusable === day.date ? 0 : -1}
                aria-selected={isSelected}
                aria-label={dayLabel(day, races.map((x) => x.nom))}
                className={`cal-cell${day.is_today ? " cal-today" : ""}${outside ? " cal-outside" : ""}${isSelected ? " cal-selected" : ""}`}
                onClick={() => { props.onSelect(day.date); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    props.onSelect(day.date);
                  } else {
                    onKeyDown(event, day.date);
                  }
                }}
              >
                <span className="cal-daynum">
                  <span className="cal-dow" aria-hidden="true">{DOW[i]} </span>
                  {Number(day.date.slice(8))}
                  {day.date.slice(8) === "01" && view === "mois" ? ` ${formatDay(day.date).split(" ")[1] ?? ""}` : ""}
                </span>
                {races.map((x) => (
                  <span key={x.id} className="cal-race" title={x.nom}>⚑ {x.nom}</span>
                ))}
                {day.sessions.map((s) => (
                  <span
                    key={s.planned.id}
                    className={`cal-session cal-st-${s.status.replace(/\s/g, "-")}`}
                    style={{ ["--plan-color" as string]: planColor(s.planned.plan_id) }}
                    title={`${s.planned.titre} · ${s.status}`}
                  >
                    <span className="cal-dot" aria-hidden="true" />
                    <span className="cal-session-text">
                      {s.planned.titre}
                      {view === "semaine" && s.planned.duree_min ? ` · ${formatDuration(s.planned.duree_min)}` : ""}
                    </span>
                  </span>
                ))}
                {day.unplanned_activities.length > 0 && (
                  <span className="cal-session cal-st-imprévu" title="Sortie non prévue">
                    <span className="cal-dot" style={{ ["--plan-color" as string]: NO_PLAN_COLOR }} aria-hidden="true" />
                    <span className="cal-session-text">{day.unplanned_activities.length} sortie(s) non prévue(s)</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DayDetail({ day, races, onEdit }: { day: DayPlan; races: string[]; onEdit: (p: SessionMatch["planned"] | { date: string }) => void }) {
  return (
    <section className="cal-detail" aria-label={`Détail du ${formatWeekdayDay(day.date)}`}>
      <header>
        <h2>
          <span className="plan-weekday">{day.weekday}</span> <span className="muted">{formatDay(day.date)}</span>
        </h2>
        <button type="button" className="btn btn-small" onClick={() => { onEdit({ date: day.date }); }}>
          + Ajouter une séance
        </button>
      </header>
      {races.map((nom) => (
        <p key={nom} className="cal-race-line">⚑ Course : <strong>{nom}</strong></p>
      ))}
      {day.sessions.length === 0 && day.unplanned_activities.length === 0 && <p className="muted">Rien de prévu ni de réalisé ce jour-là.</p>}
      {day.sessions.map((m) => {
        const { planned, activity } = m;
        const gap = gapText(m);
        return (
          <article key={planned.id} className="cal-session-detail" style={{ ["--plan-color" as string]: planColor(planned.plan_id) }}>
            <div className="cal-session-head">
              <span className="cal-dot" aria-hidden="true" />
              <strong>{planned.titre}</strong>
              <StatusChip status={m.status} />
              <button type="button" className="btn btn-small" onClick={() => { onEdit(planned); }} aria-label={`Modifier ${planned.titre}`}>
                Modifier
              </button>
            </div>
            <p className="muted">
              {planned.type_label}
              {plannedText(planned) && ` · ${plannedText(planned)}`}
              {planned.plan_nom && ` · plan : ${planned.plan_nom}`}
            </p>
            {planned.objectif && <p><strong>Objectif :</strong> {planned.objectif}</p>}
            {planned.consignes && <p><strong>Consignes :</strong> {planned.consignes}</p>}
            <p className="cal-done">
              {activity ? (
                <>
                  Réalisé : {activityText(activity)}
                  {gap && <span className="muted"> ({gap})</span>}
                </>
              ) : (
                <span className="muted">Pas encore de sortie associée.</span>
              )}
            </p>
          </article>
        );
      })}
      {day.unplanned_activities.map((a) => (
        <article key={a.id} className="cal-session-detail">
          <div className="cal-session-head">
            <strong>Sortie non prévue</strong>
            <StatusChip status="imprévu" />
          </div>
          <p>{activityText(a)}</p>
        </article>
      ))}
    </section>
  );
}
