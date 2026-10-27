import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchActivities, fetchEntries, fetchFuelingSeries, putEntry } from "../api/endpoints";
import type { Activity, Entry, EntryInput, FuelingPoint } from "../api/types";
import { addDays, formatDuration, formatWeekdayDay, todayIso } from "../app/format";
import { formatEntry } from "./exports";
import { FuelingForm } from "./FuelingWidget";
import { sportLabel } from "./labels";
import { invalidateTraining } from "./queries";
import { registerWidget } from "./registry";
import { WidgetData } from "./states";
import type { WidgetProps } from "./types";

interface EntrySettings extends Record<string, unknown> {
  day: "today" | "yesterday";
}

const dayFor = (setting: unknown): string => (setting === "yesterday" ? addDays(todayIso(), -1) : todayIso());

/** Rangée de pastilles 0–10 : un appui valide, un second appui sur la même valeur l'efface. */
function Scale({
  label,
  value,
  onPick,
  hint,
}: {
  label: string;
  value: number | null;
  onPick: (value: number | null) => void;
  hint?: string;
}) {
  return (
    <fieldset className="scale">
      <legend>
        {label} {hint && <span className="muted">{hint}</span>}
      </legend>
      <div className="scale-row">
        {Array.from({ length: 11 }, (_, n) => (
          <button
            key={n}
            type="button"
            className={`scale-btn${value === n ? " scale-btn-on" : ""}`}
            aria-pressed={value === n}
            aria-label={`${label} : ${n}`}
            onClick={() => { onPick(value === n ? null : n); }}
          >
            {n}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Durée à partir de laquelle une sortie est « longue » (nutrition à saisir), en minutes. */
const LONG_OUTING_MIN = 150;

function EntryForm({
  day,
  activities,
  entry,
  fueling,
}: {
  day: string;
  activities: Activity[];
  entry: Entry | null;
  fueling: FuelingPoint[];
}) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState(entry?.note ?? "");
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => { setNote(entry?.note ?? ""); }, [entry?.note]);

  const save = useMutation({
    mutationFn: (body: EntryInput) => putEntry(day, body),
    onSuccess: async () => {
      setJustSaved(true);
      await invalidateTraining(queryClient);
    },
  });
  const send = (body: EntryInput) => {
    setJustSaved(false);
    save.mutate(body);
  };
  const rpeFor = (activityId: number): number | null =>
    entry?.sessions.find((s) => s.activity_id === activityId)?.rpe ?? null;

  return (
    <div className="entry">
      <p className="entry-day">{formatWeekdayDay(day)}</p>
      {activities.length === 0 ? (
        <p className="muted">Aucune sortie ce jour-là : pas de RPE à saisir.</p>
      ) : (
        activities.map((a) => (
          <Scale
            key={a.id}
            label={`Effort perçu (RPE) — ${sportLabel(a.sport)} ${formatDuration(a.duration_min)}`}
            hint="0 repos · 10 maximal"
            value={rpeFor(a.id)}
            onPick={(rpe) => { send({ sessions: [{ activity_id: a.id, rpe }] }); }}
          />
        ))
      )}
      {activities
        .filter((a) => a.duration_min > LONG_OUTING_MIN)
        .map((a) => (
          <div key={a.id} className="entry-fueling">
            <p className="entry-day">
              Nutrition de la sortie longue — {sportLabel(a.sport)} {formatDuration(a.duration_min)}
            </p>
            <FuelingForm activityId={a.id} point={fueling.find((p) => p.activity_id === a.id)} />
          </div>
        ))}
      <Scale
        label="Courbatures"
        hint="0 aucune · 10 très fortes"
        value={entry?.courbatures ?? null}
        onPick={(courbatures) => { send({ courbatures }); }}
      />
      <div className="entry-row">
        <button
          type="button"
          className={`btn${entry?.malade ? " btn-primary" : ""}`}
          aria-pressed={entry?.malade === true}
          onClick={() => { send({ malade: entry?.malade ? null : true }); }}
        >
          Malade
        </button>
        <label className="entry-note">
          <span className="muted">Note</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={note}
            placeholder="Sensations, sommeil, douleurs…"
            onChange={(event) => { setNote(event.target.value); setJustSaved(false); }}
            onBlur={() => {
              const trimmed = note.trim();
              if (trimmed !== (entry?.note ?? "")) send({ note: trimmed || null });
            }}
          />
        </label>
      </div>
      <p className="entry-status" role="status">
        {save.isPending && "Enregistrement…"}
        {save.isError && <span className="form-error">{save.error.message}</span>}
        {justSaved && !save.isPending && !save.isError && "Enregistré ✓"}
      </p>
    </div>
  );
}

export function EveningEntryWidget({ settings }: WidgetProps<EntrySettings>) {
  const day = dayFor(settings.day);
  const activities = useQuery({
    queryKey: ["activities", "day", day],
    queryFn: () => fetchActivities({ from: day, to: day, limit: 10 }),
  });
  const entries = useQuery({ queryKey: ["entries", day], queryFn: () => fetchEntries(day, day) });
  // Nutrition des sorties longues : une absence de réponse n'empêche pas la saisie du soir.
  const fueling = useQuery({ queryKey: ["fueling", "series", 2], queryFn: () => fetchFuelingSeries(2) });
  return (
    <WidgetData query={activities}>
      {(acts) => (
        <WidgetData query={entries}>
          {(rows) => (
            <EntryForm
              day={day}
              activities={[...acts].reverse()}
              entry={rows[0] ?? null}
              fueling={fueling.data?.points ?? []}
            />
          )}
        </WidgetData>
      )}
    </WidgetData>
  );
}

registerWidget<EntrySettings>({
  id: "evening-entry",
  title: "Saisie du soir",
  description: "RPE de la séance, courbatures, malade, note : un appui par valeur, enregistré aussitôt.",
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 4, h: 6 },
  defaultSettings: { day: "today" },
  settingsSchema: [
    {
      key: "day",
      label: "Jour saisi",
      type: "select",
      options: [
        { value: "today", label: "Aujourd'hui" },
        { value: "yesterday", label: "Hier" },
      ],
    },
  ],
  Component: EveningEntryWidget,
  exportData: async (settings) => {
    const day = dayFor(settings.day);
    const markdown = formatEntry(day, (await fetchEntries(day, day))[0] ?? null);
    return markdown ? { title: "Saisie du soir", markdown } : null;
  },
});
