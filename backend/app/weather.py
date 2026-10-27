"""Météo du jour de sortie via Open-Meteo (service gratuit, sans clé).

Seules les coordonnées du lieu choisi sont envoyées (aucune donnée de santé ni d'entraînement).
Les réponses sont gardées en mémoire 30 minutes ; si le service est injoignable, la dernière
prévision connue est affichée avec sa date (« données du … »), sans erreur bloquante.
Données : Open-Meteo.com (licence CC BY 4.0).
"""

import logging
import threading
import time
from collections.abc import Callable
from datetime import date
from typing import Any

import httpx
from pydantic import BaseModel

from app.metrics.models import Evidence

logger = logging.getLogger(__name__)

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
CACHE_TTL_S = 1800
FORECAST_DAYS = 14
HOURLY = (
    "temperature_2m,apparent_temperature,precipitation_probability,precipitation,"
    "wind_speed_10m,wind_gusts_10m,weather_code"
)
DAILY = "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,sunrise,sunset"
ATTRIBUTION = "Prévisions : Open-Meteo.com (CC BY 4.0)."

# Codes météo WMO -> libellé français
WMO: dict[int, str] = {
    0: "Ciel dégagé", 1: "Plutôt dégagé", 2: "Partiellement nuageux", 3: "Couvert",
    45: "Brouillard", 48: "Brouillard givrant",
    51: "Bruine légère", 53: "Bruine", 55: "Bruine forte", 56: "Bruine verglaçante",
    57: "Bruine verglaçante forte",
    61: "Pluie faible", 63: "Pluie", 65: "Pluie forte", 66: "Pluie verglaçante",
    67: "Pluie verglaçante forte",
    71: "Neige faible", 73: "Neige", 75: "Neige forte", 77: "Grains de neige",
    80: "Averses faibles", 81: "Averses", 82: "Averses violentes",
    85: "Averses de neige", 86: "Fortes averses de neige",
    95: "Orage", 96: "Orage avec grêle", 99: "Orage violent avec grêle",
}  # fmt: skip


class WeatherError(Exception):
    """Prévision indisponible (message lisible, en français)."""


class NoForecastError(WeatherError):
    """Jour hors de la fenêtre de prévision."""


class Place(BaseModel):
    nom: str
    lat: float
    lon: float


class HourPoint(BaseModel):
    hour: int
    temp_c: float | None
    feels_c: float | None
    rain_prob_pct: float | None
    rain_mm: float | None
    wind_kmh: float | None
    gust_kmh: float | None
    label: str


class Period(BaseModel):
    name: str
    temp_c: float | None
    rain_prob_pct: float | None
    rain_mm: float | None
    wind_kmh: float | None


class DaySummary(BaseModel):
    date: date
    label: str
    temp_min_c: float | None
    temp_max_c: float | None
    rain_mm: float | None
    rain_prob_max_pct: float | None
    wind_max_kmh: float | None
    gust_max_kmh: float | None
    sunrise: str | None
    sunset: str | None


class WeatherDay(BaseModel):
    place: Place
    day: DaySummary
    periods: list[Period]
    hours: list[HourPoint]
    fetched_at: float
    stale: bool
    attribution: str = ATTRIBUTION
    evidence: Evidence


def label(code: Any) -> str:
    return WMO.get(int(code), "Conditions variables") if isinstance(code, int | float) else "—"


def _num(value: Any, digits: int = 1) -> float | None:
    return round(float(value), digits) if isinstance(value, int | float) else None


def _max(values: list[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return max(present) if present else None


def _mean(values: list[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return round(sum(present) / len(present), 1) if present else None


def build_day(
    data: dict[str, Any], day: date, place: Place, fetched_at: float, stale: bool
) -> WeatherDay:
    """Résumé d'un jour à partir de la réponse Open-Meteo ; lève WeatherError si le jour manque."""
    hourly = data.get("hourly") or {}
    daily = data.get("daily") or {}
    iso = day.isoformat()
    times: list[str] = hourly.get("time") or []
    idx = [i for i, t in enumerate(times) if t.startswith(iso)]
    days: list[str] = daily.get("time") or []
    if not idx or iso not in days:
        raise NoForecastError(
            f"Pas de prévision pour le {day.strftime('%d/%m/%Y')} : disponible jusqu'à "
            f"{FORECAST_DAYS} jours à l'avance, pas dans le passé."
        )
    d = days.index(iso)

    def col(name: str) -> list[Any]:
        values = hourly.get(name) or []
        return [values[i] if i < len(values) else None for i in idx]

    temps, feels = col("temperature_2m"), col("apparent_temperature")
    prob, rain = col("precipitation_probability"), col("precipitation")
    wind, gust, code = col("wind_speed_10m"), col("wind_gusts_10m"), col("weather_code")
    hours = [
        HourPoint(
            hour=int(times[i][11:13]),
            temp_c=_num(temps[k]),
            feels_c=_num(feels[k]),
            rain_prob_pct=_num(prob[k], 0),
            rain_mm=_num(rain[k]),
            wind_kmh=_num(wind[k], 0),
            gust_kmh=_num(gust[k], 0),
            label=label(code[k]),
        )
        for k, i in enumerate(idx)
    ]

    def period(name: str, start: int, end: int) -> Period:
        sel = [h for h in hours if start <= h.hour < end]
        return Period(
            name=name,
            temp_c=_mean([h.temp_c for h in sel]),
            rain_prob_pct=_max([h.rain_prob_pct for h in sel]),
            rain_mm=round(sum(h.rain_mm or 0 for h in sel), 1) if sel else None,
            wind_kmh=_max([h.wind_kmh for h in sel]),
        )

    def daily_value(name: str) -> Any:
        values = daily.get(name) or []
        return values[d] if d < len(values) else None

    waking = [h for h in hours if 5 <= h.hour <= 22]  # heures de sortie plausibles (pas la nuit)
    sunrise, sunset = daily_value("sunrise"), daily_value("sunset")
    summary = DaySummary(
        date=day,
        label=label(daily_value("weather_code")),
        temp_min_c=_num(daily_value("temperature_2m_min")),
        temp_max_c=_num(daily_value("temperature_2m_max")),
        rain_mm=_num(daily_value("precipitation_sum")),
        rain_prob_max_pct=_max([h.rain_prob_pct for h in waking]),
        wind_max_kmh=_max([h.wind_kmh for h in waking]),
        gust_max_kmh=_max([h.gust_kmh for h in waking]),
        sunrise=sunrise[11:16] if isinstance(sunrise, str) else None,
        sunset=sunset[11:16] if isinstance(sunset, str) else None,
    )
    return WeatherDay(
        place=place,
        day=summary,
        periods=[
            period("Matin (6–12 h)", 6, 12),
            period("Après-midi (12–18 h)", 12, 18),
            period("Soir (18–22 h)", 18, 22),
        ],
        hours=waking,
        fetched_at=fetched_at,
        stale=stale,
        evidence=Evidence(
            level="indicatif",
            summary=(
                "Prévision d'un modèle météo, d'autant moins fiable que l'échéance est lointaine : "
                "à revoir la veille de la sortie."
            ),
        ),
    )


class WeatherService:
    def __init__(
        self,
        *,
        client: httpx.Client | None = None,
        forecast_url: str = FORECAST_URL,
        geocode_url: str = GEOCODE_URL,
        clock: Callable[[], float] = time.time,
        timezone: str = "Europe/Paris",
    ) -> None:
        self._client = client or httpx.Client(timeout=10.0)
        self._forecast_url = forecast_url
        self._geocode_url = geocode_url
        self._clock = clock
        self._tz = timezone
        self._lock = threading.Lock()
        self._cache: dict[tuple[float, float], tuple[float, dict[str, Any]]] = {}

    def _get(self, url: str, params: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._client.get(url, params=params)
        except httpx.HTTPError as exc:
            raise WeatherError(f"Service météo injoignable ({type(exc).__name__}).") from None
        if response.status_code >= 400:
            raise WeatherError(f"Service météo en erreur (HTTP {response.status_code}).")
        try:
            body = response.json()
        except ValueError:
            raise WeatherError("Réponse du service météo illisible.") from None
        if not isinstance(body, dict):
            raise WeatherError("Réponse du service météo inattendue.")
        return body

    def geocode(self, query: str) -> list[Place]:
        body = self._get(
            self._geocode_url, {"name": query, "count": 6, "language": "fr", "format": "json"}
        )
        places: list[Place] = []
        for r in body.get("results") or []:
            if (
                isinstance(r, dict)
                and isinstance(r.get("latitude"), int | float)
                and isinstance(r.get("longitude"), int | float)
            ):
                where = ", ".join(
                    str(x) for x in (r.get("name"), r.get("admin1"), r.get("country")) if x
                )
                places.append(
                    Place(
                        nom=where,
                        lat=round(float(r["latitude"]), 4),
                        lon=round(float(r["longitude"]), 4),
                    )
                )
        return places

    def forecast(self, place: Place, day: date) -> WeatherDay:
        key = (round(place.lat, 3), round(place.lon, 3))
        now = self._clock()
        with self._lock:
            cached = self._cache.get(key)
        data: dict[str, Any]
        stale = False
        if cached is not None and now - cached[0] < CACHE_TTL_S:
            fetched, data = cached
        else:
            try:
                data = self._get(
                    self._forecast_url,
                    {
                        "latitude": place.lat,
                        "longitude": place.lon,
                        "hourly": HOURLY,
                        "daily": DAILY,
                        "timezone": self._tz,
                        "forecast_days": FORECAST_DAYS,
                        "wind_speed_unit": "kmh",
                    },
                )
            except WeatherError:
                if cached is None:
                    raise
                logger.warning("Météo injoignable : dernière prévision connue conservée")
                fetched, data, stale = cached[0], cached[1], True
            else:
                fetched = now
                with self._lock:
                    self._cache[key] = (now, data)
        return build_day(data, day, place, fetched, stale)
