import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "../api/client";
import { fetchWeather, fetchWeatherLocation, geocodePlace, setWeatherLocation } from "../api/endpoints";
import type { WeatherPlace, WeatherResponse } from "../api/types";
import { formatDay, formatDuration, formatNumber } from "../app/format";
import { EvidenceNote } from "./common";
import { formatWeather } from "./exports";
import { REFRESH_MS } from "./queries";
import { registerWidget } from "./registry";
import { WidgetEmpty, WidgetError, WidgetLoading } from "./states";
import type { WidgetProps } from "./types";
import { SummaryLayout } from "./summary";

interface WeatherSettings extends Record<string, unknown> {
  day: "session" | "today" | "tomorrow";
}

const dayFor = (value: unknown): "session" | "today" | "tomorrow" => (value === "today" || value === "tomorrow" ? value : "session");
const t = (v: number | null, unit: string, digits: 0 | 1 | 2 = 0): string => (v === null ? "—" : `${formatNumber(v, digits)} ${unit}`);

function PlacePicker({ current, onDone }: { current: WeatherPlace | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const search = useMutation({ mutationFn: (q: string) => geocodePlace(q) });
  const choose = useMutation({
    mutationFn: (place: WeatherPlace) => setWeatherLocation(place),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["weather"] }),
        queryClient.invalidateQueries({ queryKey: ["weather-location"] }),
      ]);
      onDone();
    },
  });
  return (
    <form
      className="fueling-form"
      aria-label="Lieu de la météo"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim().length >= 2) search.mutate(text.trim());
      }}
    >
      <label className="field">
        <span className="muted">{current ? `Lieu actuel : ${current.nom}. Changer de lieu` : "Lieu de vos sorties (ville, commune)"}</span>
        <input type="text" value={text} placeholder="ex. Bruniquel" onChange={(event) => { setText(event.target.value); }} />
      </label>
      <div className="entry-row">
        <button type="submit" className="btn btn-small" disabled={text.trim().length < 2 || search.isPending}>
          Chercher
        </button>
        {current && (
          <button type="button" className="btn btn-small" onClick={onDone}>
            Annuler
          </button>
        )}
      </div>
      {search.isError && <p className="form-error">{search.error.message}</p>}
      {search.data?.length === 0 && <p className="muted">Aucun lieu trouvé.</p>}
      {search.data && search.data.length > 0 && (
        <ul className="notes">
          {search.data.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button type="button" className="btn btn-small" disabled={choose.isPending} onClick={() => { choose.mutate(p); }}>
                {p.nom}
              </button>
            </li>
          ))}
        </ul>
      )}
      {choose.isError && <p className="form-error">{choose.error.message}</p>}
    </form>
  );
}

export function WeatherView({ data, onChangePlace }: { data: WeatherResponse; onChangePlace: () => void }) {
  const w = data.weather;
  const d = w.day;
  const rainy = (d.rain_prob_max_pct ?? 0) >= 50 || (d.rain_mm ?? 0) >= 2;
  return (
    <div className="weather">
      <p className="weather-session">
        {data.session ? (
          <>
            Séance prévue le {formatDay(data.session.date)} : <strong>{data.session.titre}</strong> ({data.session.type_label}
            {data.session.duree_min ? `, ${formatDuration(data.session.duree_min)}` : ""})
          </>
        ) : (
          <>Aucune séance prévue : météo du {formatDay(d.date)}.</>
        )}
      </p>
      <div className="stats">
        <div className="stat">
          <span className="stat-label">{w.place.nom}</span>
          <span className="stat-value">{d.label}</span>
          <span className="stat-sub">{formatDay(d.date)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Température</span>
          <span className="stat-value">
            {t(d.temp_min_c, "")}–{t(d.temp_max_c, "°C")}
          </span>
          <span className="stat-sub">soleil {d.sunrise ?? "—"}–{d.sunset ?? "—"}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Pluie</span>
          <span className="stat-value">{t(d.rain_mm, "mm", 1)}</span>
          <span className="stat-sub">probabilité max {t(d.rain_prob_max_pct, "%")}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Vent</span>
          <span className="stat-value">{t(d.wind_max_kmh, "km/h")}</span>
          <span className="stat-sub">rafales {t(d.gust_max_kmh, "km/h")}</span>
        </div>
      </div>
      {w.stale && (
        <p className="notice notice-warn" role="note">
          Service météo injoignable : dernière prévision connue conservée.
        </p>
      )}
      {rainy && <p className="muted">Pluie probable : prévoir une veste et des chaussures adaptées au terrain mouillé (information).</p>}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Période</th>
              <th scope="col">Temp.</th>
              <th scope="col">Pluie</th>
              <th scope="col">Vent max</th>
            </tr>
          </thead>
          <tbody>
            {w.periods.map((p) => (
              <tr key={p.name}>
                <th scope="row">{p.name}</th>
                <td>{t(p.temp_c, "°C")}</td>
                <td>
                  {t(p.rain_prob_pct, "%")} · {t(p.rain_mm, "mm", 1)}
                </td>
                <td>{t(p.wind_kmh, "km/h")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Heure par heure</summary>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Heure</th>
                <th scope="col">Temps</th>
                <th scope="col">Temp.</th>
                <th scope="col">Pluie</th>
                <th scope="col">Vent</th>
              </tr>
            </thead>
            <tbody>
              {w.hours
                .filter((h) => h.hour % 2 === 0)
                .map((h) => (
                  <tr key={h.hour}>
                    <th scope="row">{h.hour} h</th>
                    <td>{h.label}</td>
                    <td>{t(h.temp_c, "°C")}</td>
                    <td>{t(h.rain_prob_pct, "%")}</td>
                    <td>{t(h.wind_kmh, "km/h")}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
      <div className="entry-row">
        <button type="button" className="btn btn-small" onClick={onChangePlace}>
          Changer de lieu
        </button>
      </div>
      <EvidenceNote evidence={w.evidence} />
      <p className="muted">{w.attribution}</p>
    </div>
  );
}

export function WeatherWidget({ settings }: WidgetProps<WeatherSettings>) {
  const day = dayFor(settings.day);
  const [changing, setChanging] = useState(false);
  const location = useQuery({ queryKey: ["weather-location"], queryFn: fetchWeatherLocation });
  const place = location.data ?? null;
  const forecast = useQuery({
    queryKey: ["weather", day, place?.lat, place?.lon],
    queryFn: () => fetchWeather(day),
    enabled: place !== null,
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  if (location.isPending) return <WidgetLoading />;
  if (location.isError) return <WidgetError message={location.error.message} onRetry={() => void location.refetch()} />;
  if (place === null || changing) {
    return (
      <>
        {place === null && <WidgetEmpty message="Choisissez le lieu de vos sorties pour voir la météo." />}
        <PlacePicker current={place} onDone={() => { setChanging(false); }} />
      </>
    );
  }
  if (forecast.isPending) return <WidgetLoading />;
  if (forecast.isError) {
    const unavailable = forecast.error instanceof ApiError && forecast.error.status === 404;
    return unavailable ? (
      <WidgetEmpty message={forecast.error.message} />
    ) : (
      <WidgetError message={forecast.error.message} onRetry={() => void forecast.refetch()} />
    );
  }
  return <WeatherView data={forecast.data} onChangePlace={() => { setChanging(true); }} />;
}

export function WeatherSummary({ settings }: WidgetProps<WeatherSettings>) {
  const day = dayFor(settings.day);
  const location = useQuery({ queryKey: ["weather-location"], queryFn: fetchWeatherLocation });
  const place = location.data ?? null;
  const forecast = useQuery({
    queryKey: ["weather", day, place?.lat, place?.lon],
    queryFn: () => fetchWeather(day),
    enabled: place !== null,
    refetchInterval: REFRESH_MS,
    retry: false,
  });
  if (location.isPending || (place !== null && forecast.isPending)) return <WidgetLoading />;
  if (place === null) return <WidgetEmpty message="Lieu à choisir : ouvrez le détail." />;
  if (forecast.isError) return <WidgetError message={forecast.error.message} onRetry={() => void forecast.refetch()} />;
  if (!forecast.data) return <WidgetLoading />;
  const d = forecast.data.weather.day;
  return (
    <SummaryLayout
      value={`${formatNumber(d.temp_min_c)}–${formatNumber(d.temp_max_c)}`}
      unit="°C"
      sub={`${d.label} · pluie ${formatNumber(d.rain_prob_max_pct)} % · vent ${formatNumber(d.wind_max_kmh)} km/h`}
    />
  );
}

registerWidget<WeatherSettings>({
  id: "weather",
  title: "Météo du jour de sortie",
  description: "Prévisions du jour de la prochaine séance prévue (Open-Meteo, sans clé) pour le lieu de votre choix.",
  defaultSize: { w: 4, h: 4 },
  minSize: { w: 3, h: 3 },
  defaultSettings: { day: "session" },
  settingsSchema: [
    {
      key: "day",
      label: "Jour affiché",
      type: "select",
      options: [
        { value: "session", label: "Prochaine séance prévue" },
        { value: "today", label: "Aujourd'hui" },
        { value: "tomorrow", label: "Demain" },
      ],
    },
  ],
  Component: WeatherWidget,
  Summary: WeatherSummary,
  exportData: async (settings) => {
    try {
      return { title: "Météo du jour de sortie", markdown: formatWeather(await fetchWeather(dayFor(settings.day))) };
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.status === 404)) return null;
      throw error;
    }
  },
});
