import { useEffect, useRef, useState } from "react";
import { Markdown } from "./markdown";
import { registerWidget } from "./registry";
import type { WidgetProps } from "./types";

interface NoteSettings extends Record<string, unknown> {
  text: string;
  fontSize: "small" | "normal" | "large";
}

const SAVE_DELAY_MS = 500;

/** Bloc texte (markdown simple : titres, listes, gras, italique, liens). Lecture / édition. */
export function NoteWidget({ settings, updateSettings, instanceId }: WidgetProps<NoteSettings>) {
  const [value, setValue] = useState(settings.text);
  const [editing, setEditing] = useState(settings.text === "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ value, saved: settings.text, updateSettings });
  latest.current = { value, saved: settings.text, updateSettings };

  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { value: current, saved, updateSettings: update } = latest.current;
    if (current !== saved) update({ text: current });
  };

  // Le texte en cours de frappe est enregistré avec un léger délai, à la sortie du champ et au démontage.
  useEffect(() => commit, []);

  return (
    <div className={`note note-${settings.fontSize}`} data-instance={instanceId}>
      <div className="note-toolbar">
        <button
          type="button"
          className="btn btn-small"
          aria-pressed={editing}
          onClick={() => {
            if (editing) commit();
            setEditing(!editing);
          }}
        >
          {editing ? "Aperçu" : "Modifier"}
        </button>
      </div>
      {editing ? (
        <textarea
          className="note-area"
          aria-label="Note libre"
          placeholder="Écrivez ici (markdown simple : # titre, - liste, **gras**, [lien](https://…))"
          value={value}
          maxLength={5000}
          onChange={(event) => {
            setValue(event.target.value);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(commit, SAVE_DELAY_MS);
          }}
          onBlur={commit}
        />
      ) : value.trim() ? (
        <Markdown source={value} />
      ) : (
        <p className="muted">Note vide.</p>
      )}
    </div>
  );
}

registerWidget<NoteSettings>({
  id: "note",
  title: "Note libre",
  description: "Un bloc-notes en markdown simple (titres, listes, liens) ; inclus dans l'export vers Claude.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 2, h: 2 },
  defaultSettings: { text: "", fontSize: "normal" },
  settingsSchema: [
    {
      key: "fontSize",
      label: "Taille du texte",
      type: "select",
      options: [
        { value: "small", label: "Petite" },
        { value: "normal", label: "Normale" },
        { value: "large", label: "Grande" },
      ],
    },
  ],
  Component: NoteWidget,
  exportData: (settings) => {
    const text = settings.text.trim();
    return text ? { title: "Note libre", markdown: `## Note libre\n\n${text}\n` } : null;
  },
});
