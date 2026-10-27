"""Météo (Open-Meteo) : lieu configurable, séance prévue, cache, repli sur la dernière prévision."""

from collections.abc import Iterator
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.weather import CACHE_TTL_S, WMO, WeatherService, label

TODAY = date(2026, 10, 15)


class FakeOpenMeteo:
    def __init__(self) -> None:
        self.forecast_calls: list[httpx.Request] = []
        self.geocode_calls: list[httpx.Request] = []
        self.down = False
        self.status = 200
        self.places: list[dict[str, Any]] = [
            {
                "name": "Bruniquel", "admin1": "Occitanie", "country": "France",
                "latitude": 44.0364, "longitude": 1.6667,
            },
            {"name": "Bruniquel", "country": "Quelque part", "latitude": 1.0, "longitude": 2.0},
            {"name": "Sans coordonnées"},
        ]  # fmt: skip

    def handler(self, request: httpx.Request) -> httpx.Response:
        if self.down:
            raise httpx.ConnectError("panne")
        if request.url.host.startswith("geocoding"):
            self.geocode_calls.append(request)
            return httpx.Response(200, json={"results": self.places})
        self.forecast_calls.append(request)
        if self.status != 200:
            return httpx.Response(self.status, json={"error": True})
        return httpx.Response(200, json=forecast_payload())

    def service(self, now: list[float]) -> WeatherService:
        return WeatherService(
            client=httpx.Client(transport=httpx.MockTransport(self.handler)), clock=lambda: now[0]
        )


def forecast_payload(days: int = 3) -> dict[str, Any]:
    """3 jours dès le 15/10 : temp = 8 + heure, proba pluie = 3 × heure, vent = 10 + heure."""
    times: list[str] = []
    for d in range(days):
        day = (TODAY + timedelta(days=d)).isoformat()
        times += [f"{day}T{h:02d}:00" for h in range(24)]
    hours = [int(t[11:13]) for t in times]
    return {
        "hourly": {
            "time": times,
            "temperature_2m": [8.0 + h for h in hours],
            "apparent_temperature": [6.0 + h for h in hours],
            "precipitation_probability": [min(100, 3 * h) for h in hours],
            "precipitation": [0.1 for _ in hours],
            "wind_speed_10m": [10.0 + h for h in hours],
            "wind_gusts_10m": [20.0 + h for h in hours],
            "weather_code": [61 if 12 <= h < 18 else 3 for h in hours],
        },
        "daily": {
            "time": [(TODAY + timedelta(days=d)).isoformat() for d in range(days)],
            "weather_code": [3, 63, 0],
            "temperature_2m_max": [31.0, 30.0, 29.0],
            "temperature_2m_min": [8.0, 7.0, 6.0],
            "precipitation_sum": [2.4, 5.5, 0.0],
            "sunrise": [f"{(TODAY + timedelta(days=d)).isoformat()}T07:52" for d in range(days)],
            "sunset": [f"{(TODAY + timedelta(days=d)).isoformat()}T18:41" for d in range(days)],
        },
    }


@pytest.fixture
def env(tmp_path: Path) -> Iterator[tuple[TestClient, FakeOpenMeteo, list[float]]]:
    app = create_app(Settings(database_path=str(tmp_path / "w.db"), scheduler_enabled=False))
    app.state.today = lambda: TODAY
    fake = FakeOpenMeteo()
    now = [1_800_000_000.0]
    app.state.weather = fake.service(now)
    with TestClient(app) as client:
        yield client, fake, now


def set_place(client: TestClient) -> None:
    r = client.put(
        "/api/weather/location", json={"nom": "Bruniquel, Occitanie", "lat": 44.0364, "lon": 1.6667}
    )
    assert r.status_code == 200


def plan(
    client: TestClient, day: str, titre: str, type_: str = "cotes", duree: int | None = 60
) -> None:
    body: dict[str, Any] = {"date": day, "titre": titre, "type": type_}
    if duree:
        body["duree_min"] = duree
    assert client.post("/api/plan/sessions", json=body).status_code == 201


# --- lieu ---------------------------------------------------------------------------------------


def test_location_roundtrip_and_validation(
    env: tuple[TestClient, FakeOpenMeteo, list[float]],
) -> None:
    client, _, _ = env
    assert client.get("/api/weather/location").json() is None
    set_place(client)
    assert client.get("/api/weather/location").json() == {
        "nom": "Bruniquel, Occitanie",
        "lat": 44.0364,
        "lon": 1.6667,
    }
    for bad in (
        {"nom": "", "lat": 1, "lon": 1},
        {"nom": "x", "lat": 91, "lon": 1},
        {"nom": "x", "lat": 1, "lon": 181},
        {"nom": "x", "lat": 1},
    ):
        assert client.put("/api/weather/location", json=bad).status_code == 422
    assert client.delete("/api/weather/location").status_code == 204
    assert client.get("/api/weather/location").json() is None


def test_geocoding_returns_usable_places_and_sends_only_the_typed_text(
    env: tuple[TestClient, FakeOpenMeteo, list[float]],
) -> None:
    client, fake, _ = env
    places = client.get("/api/weather/geocode?q=Bruniquel").json()
    assert places == [
        {"nom": "Bruniquel, Occitanie, France", "lat": 44.0364, "lon": 1.6667},
        {"nom": "Bruniquel, Quelque part", "lat": 1.0, "lon": 2.0},
    ]
    assert dict(fake.geocode_calls[0].url.params) == {
        "name": "Bruniquel",
        "count": "6",
        "language": "fr",
        "format": "json",
    }
    assert client.get("/api/weather/geocode?q=a").status_code == 422
    fake.down = True
    r = client.get("/api/weather/geocode?q=Bruniquel")
    assert r.status_code == 502 and "injoignable" in r.json()["detail"]


# --- prévision ----------------------------------------------------------------------------------


def test_forecast_for_the_next_planned_session_hand_computed(
    env: tuple[TestClient, FakeOpenMeteo, list[float]],
) -> None:
    client, fake, _ = env
    set_place(client)
    plan(client, "2026-10-14", "Passée")  # hier : ignorée
    plan(client, "2026-10-16", "Repos", "repos", None)  # repos : ignoré
    plan(client, "2026-10-16", "Côtes courtes")
    body = client.get("/api/weather").json()
    assert body["day_basis"] == "session"
    assert body["session"] == {
        "date": "2026-10-16",
        "titre": "Côtes courtes",
        "type_label": "Côtes",
        "duree_min": 60,
    }
    w = body["weather"]
    assert w["place"]["nom"] == "Bruniquel, Occitanie" and w["stale"] is False
    day = w["day"]
    assert day["date"] == "2026-10-16" and day["label"] == "Pluie"  # code 63
    assert (day["temp_min_c"], day["temp_max_c"], day["rain_mm"]) == (7.0, 30.0, 5.5)
    assert (day["sunrise"], day["sunset"]) == ("07:52", "18:41")
    assert (
        day["rain_prob_max_pct"] == 66.0
        and day["wind_max_kmh"] == 32.0
        and day["gust_max_kmh"] == 42.0
    )  # 22 h
    morning, afternoon, evening = w["periods"]
    # temp = 8 + heure : moyennes des heures 6–11, 12–17, 18–21 = 8 + 8,5 / 14,5 / 19,5
    assert (morning["temp_c"], afternoon["temp_c"], evening["temp_c"]) == (16.5, 22.5, 27.5)
    assert (morning["rain_prob_pct"], afternoon["rain_prob_pct"], evening["rain_prob_pct"]) == (
        33.0,
        51.0,
        63.0,
    )
    assert (morning["rain_mm"], afternoon["rain_mm"], evening["rain_mm"]) == (0.6, 0.6, 0.4)
    assert (morning["wind_kmh"], evening["wind_kmh"]) == (21.0, 31.0)
    hours = {h["hour"]: h for h in w["hours"]}
    assert (
        min(hours) == 5
        and max(hours) == 22
        and hours[14]["label"] == "Pluie faible"
        and hours[8]["label"] == "Couvert"
    )
    assert (
        hours[10]["temp_c"] == 18.0
        and hours[10]["feels_c"] == 16.0
        and hours[10]["rain_prob_pct"] == 30.0
    )
    assert "Open-Meteo" in w["attribution"] and w["evidence"]["level"] == "indicatif"
    sent = dict(fake.forecast_calls[0].url.params)
    assert (
        sent["latitude"] == "44.0364"
        and sent["longitude"] == "1.6667"
        and sent["timezone"] == "Europe/Paris"
    )
    assert set(sent) == {
        "latitude",
        "longitude",
        "hourly",
        "daily",
        "timezone",
        "forecast_days",
        "wind_speed_unit",
    }


def test_without_a_planned_session_it_shows_today(
    env: tuple[TestClient, FakeOpenMeteo, list[float]],
) -> None:
    client, _, _ = env
    set_place(client)
    body = client.get("/api/weather").json()
    assert (
        body["day_basis"] == "today"
        and body["session"] is None
        and body["weather"]["day"]["date"] == "2026-10-15"
    )
    assert body["weather"]["day"]["label"] == "Couvert"


@pytest.mark.parametrize(
    ("day", "basis", "expected"),
    [
        ("today", "today", "2026-10-15"),
        ("tomorrow", "tomorrow", "2026-10-16"),
        ("2026-10-17", "date", "2026-10-17"),
    ],
)
def test_explicit_days(
    env: tuple[TestClient, FakeOpenMeteo, list[float]], day: str, basis: str, expected: str
) -> None:
    client, _, _ = env
    set_place(client)
    plan(client, "2026-10-16", "Footing", "footing")
    body = client.get(f"/api/weather?day={day}").json()
    assert body["day_basis"] == basis and body["weather"]["day"]["date"] == expected
    if expected == "2026-10-16":
        assert body["session"]["titre"] == "Footing"  # la séance prévue ce jour-là est rappelée


def test_errors(env: tuple[TestClient, FakeOpenMeteo, list[float]]) -> None:
    client, fake, _ = env
    assert client.get("/api/weather").status_code == 409  # lieu non choisi
    set_place(client)
    assert client.get("/api/weather?day=demain").status_code == 422
    past = client.get("/api/weather?day=2026-10-01")
    assert (
        past.status_code == 404 and "Pas de prévision pour le 01/10/2026" in past.json()["detail"]
    )
    far = client.get("/api/weather?day=2026-12-31")
    assert far.status_code == 404
    fake.status = 500
    client.put(
        "/api/weather/location", json={"nom": "Ailleurs", "lat": 10.0, "lon": 10.0}
    )  # hors cache
    r = client.get("/api/weather?day=today")
    assert r.status_code == 502 and "HTTP 500" in r.json()["detail"]


# --- cache et repli -----------------------------------------------------------------------------


def test_forecast_is_cached_for_thirty_minutes(
    env: tuple[TestClient, FakeOpenMeteo, list[float]],
) -> None:
    client, fake, now = env
    set_place(client)
    client.get("/api/weather?day=today")
    client.get("/api/weather?day=tomorrow")
    assert len(fake.forecast_calls) == 1
    now[0] += CACHE_TTL_S - 1
    client.get("/api/weather?day=today")
    assert len(fake.forecast_calls) == 1
    now[0] += 2
    client.get("/api/weather?day=today")
    assert len(fake.forecast_calls) == 2


def test_last_known_forecast_is_kept_when_the_service_is_down(
    env: tuple[TestClient, FakeOpenMeteo, list[float]],
) -> None:
    client, fake, now = env
    set_place(client)
    first = client.get("/api/weather?day=today").json()["weather"]
    fake.down = True
    now[0] += CACHE_TTL_S + 60
    again = client.get("/api/weather?day=today")
    assert again.status_code == 200
    w = again.json()["weather"]
    assert (
        w["stale"] is True and w["fetched_at"] == first["fetched_at"] and w["day"] == first["day"]
    )
    fake.down = False
    assert (
        client.get("/api/weather?day=today").json()["weather"]["stale"] is False
    )  # le service est revenu


def test_a_new_place_is_not_served_from_another_places_cache(
    env: tuple[TestClient, FakeOpenMeteo, list[float]],
) -> None:
    client, fake, _ = env
    set_place(client)
    client.get("/api/weather?day=today")
    client.put("/api/weather/location", json={"nom": "Ailleurs", "lat": 48.85, "lon": 2.35})
    client.get("/api/weather?day=today")
    assert len(fake.forecast_calls) == 2


def test_weather_codes_are_in_french() -> None:
    assert (
        label(0) == "Ciel dégagé" and label(95) == "Orage" and label(1234) == "Conditions variables"
    )
    assert label(None) == "—" and all(v for v in WMO.values())
