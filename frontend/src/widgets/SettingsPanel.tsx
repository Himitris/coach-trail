import type { SettingField, WidgetSettings } from "./types";

/** Formulaire de réglages généré depuis le schéma du widget (période, sport, métrique…). */
export function SettingsPanel({
  idPrefix,
  schema,
  values,
  onChange,
}: {
  idPrefix: string;
  schema: readonly SettingField[];
  values: WidgetSettings;
  onChange: (patch: WidgetSettings) => void;
}) {
  return (
    <form
      className="settings-panel"
      onSubmit={(event) => { event.preventDefault(); }}
      aria-label="Réglages du widget"
    >
      {schema.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const value = values[field.key];
        return (
          <div className="field" key={field.key}>
            {field.type === "boolean" ? (
              <label htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={value === true}
                  onChange={(event) => { onChange({ [field.key]: event.target.checked }); }}
                />{" "}
                {field.label}
              </label>
            ) : (
              <>
                <label htmlFor={id}>{field.label}</label>
                {field.type === "select" && (
                  <select
                    id={id}
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) => { onChange({ [field.key]: event.target.value }); }}
                  >
                    {field.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                )}
                {field.type === "text" && (
                  <input
                    id={id}
                    type="text"
                    placeholder={field.placeholder}
                    value={typeof value === "string" ? value : ""}
                    onChange={(event) => { onChange({ [field.key]: event.target.value }); }}
                  />
                )}
                {field.type === "number" && (
                  <input
                    id={id}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    value={typeof value === "number" ? value : ""}
                    onChange={(event) => {
                      const n = event.target.valueAsNumber;
                      if (!Number.isNaN(n)) onChange({ [field.key]: n });
                    }}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </form>
  );
}
