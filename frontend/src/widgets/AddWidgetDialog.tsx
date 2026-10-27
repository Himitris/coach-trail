import { useEffect, useRef } from "react";
import { listWidgets } from "./registry";
import type { WidgetSettings } from "./types";

/** Catalogue des widgets disponibles (ouvert par « + Widget »). */
export function AddWidgetDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (type: string, defaultSettings: WidgetSettings) => void;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const widgets = listWidgets();
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-title"
        onClick={(event) => { event.stopPropagation(); }}
      >
        <div className="dialog-head">
          <h2 id="catalog-title">Ajouter un widget</h2>
          <button type="button" className="btn btn-small" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <ul className="catalog">
          {widgets.map((def, index) => (
            <li key={def.id}>
              <div>
                <strong>{def.title}</strong>
                <p>{def.description}</p>
              </div>
              <button
                ref={index === 0 ? firstRef : undefined}
                type="button"
                className="btn btn-primary"
                onClick={() => { onPick(def.id, structuredClone(def.defaultSettings)); }}
              >
                Ajouter
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
