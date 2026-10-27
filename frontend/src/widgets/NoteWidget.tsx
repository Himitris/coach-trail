import { useEffect, useRef, useState } from "react";
import { registerWidget } from "./registry";
import type { WidgetProps } from "./types";

interface NoteSettings extends Record<string, unknown> {
  text: string;
  fontSize: "small" | "normal" | "large";
}

const SAVE_DELAY_MS = 500;

export function NoteWidget({ settings, updateSettings, instanceId }: WidgetProps<NoteSettings>) {
  const [value, setValue] = useState(settings.text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ value, saved: settings.text, updateSettings });
  latest.current = { value, saved: settings.text, updateSettings };

  const commit = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { value: current, saved, updateSettings: update } = latest.current;
    if (current !== saved) update({ text: current });
  };

  // Le texte en cours de frappe est enregistré avec un léger délai, et à la sortie du champ.
  useEffect(() => commit, []);  

  return (
    <textarea
      className={`note-area note-${settings.fontSize}`}
      aria-label="Note libre"
      placeholder="Écrivez ici : observations, rappels, questions pour votre coach…"
      value={value}
      maxLength={5000}
      data-instance={instanceId}
      onChange={(event) => {
        setValue(event.target.value);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(commit, SAVE_DELAY_MS);
      }}
      onBlur={commit}
    />
  );
}

registerWidget<NoteSettings>({
  id: "note",
  title: "Note libre",
  description: "Un bloc-notes pour vos remarques ; inclus dans l'export vers Claude.",
  defaultSize: { w: 4, h: 3 },
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
