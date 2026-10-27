"""Météo du jour de sortie : lieu configurable, séance prévue, prévision Open-Meteo."""

from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AthleteProfile, PlannedSession
from app.plan.schemas import TYPE_LABELS
from app.routes.deps import get_db
from app.weather import NoForecastError, Place, WeatherDay, WeatherError, WeatherService

router = APIRouter(prefix="/weather")
LOOKAHEAD_DAYS = 14


class LocationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nom: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    lat: Annotated[float, Field(ge=-90, le=90)]
    lon: Annotated[float, Field(ge=-180, le=180)]


class SessionBrief(BaseModel):
    date: date
    titre: str
    type_label: str
    duree_min: int | None


class WeatherOut(BaseModel):
    day_basis: str  # session | today | tomorrow | date
    session: SessionBrief | None
    weather: WeatherDay


def _service(request: Request) -> WeatherService:
    service: WeatherService = request.app.state.weather
    return service


def _profile(db: Session) -> AthleteProfile:
    profile = db.get(AthleteProfile, 1)
    if profile is None:
        raise HTTPException(500, "Profil absent : migrations non appliquées ?")
    return profile


def _place(profile: AthleteProfile) -> Place | None:
    if profile.meteo_lat is None or profile.meteo_lon is None:
        return None
    return Place(
        nom=profile.meteo_lieu or "Lieu choisi", lat=profile.meteo_lat, lon=profile.meteo_lon
    )


@router.get("/location", response_model=Place | None)
def get_location(db: Annotated[Session, Depends(get_db)]) -> Place | None:
    return _place(_profile(db))


@router.put("/location", response_model=Place)
def set_location(body: LocationIn, db: Annotated[Session, Depends(get_db)]) -> Place:
    profile = _profile(db)
    profile.meteo_lieu, profile.meteo_lat, profile.meteo_lon = body.nom, body.lat, body.lon
    db.commit()
    return Place(nom=body.nom, lat=body.lat, lon=body.lon)


@router.delete("/location", status_code=204)
def clear_location(db: Annotated[Session, Depends(get_db)]) -> None:
    profile = _profile(db)
    profile.meteo_lieu = profile.meteo_lat = profile.meteo_lon = None
    db.commit()


@router.get("/geocode", response_model=list[Place])
def geocode(request: Request, q: Annotated[str, Query(min_length=2, max_length=80)]) -> list[Place]:
    """Recherche d'un lieu par son nom (seul le texte tapé est envoyé à Open-Meteo)."""
    try:
        return _service(request).geocode(q.strip())
    except WeatherError as exc:
        raise HTTPException(502, str(exc)) from exc


def _pick_day(db: Session, today: date, day: str) -> tuple[date, str, PlannedSession | None]:
    if day == "today":
        return today, "today", None
    if day == "tomorrow":
        return today + timedelta(days=1), "tomorrow", None
    if day != "session":
        try:
            return date.fromisoformat(day), "date", None
        except ValueError:
            raise HTTPException(422, "« day » : session, today, tomorrow ou AAAA-MM-JJ.") from None
    upcoming = db.scalars(
        select(PlannedSession)
        .where(
            PlannedSession.date >= today,
            PlannedSession.date <= today + timedelta(days=LOOKAHEAD_DAYS),
            PlannedSession.type != "repos",
        )
        .order_by(PlannedSession.date, PlannedSession.id)
    ).first()
    if upcoming is None:
        return today, "today", None
    return upcoming.date, "session", upcoming


@router.get("", response_model=WeatherOut)
def weather(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    day: str = "session",
) -> WeatherOut:
    """Prévision du jour de la prochaine séance prévue (ou d'aujourd'hui, demain, une date)."""
    place = _place(_profile(db))
    if place is None:
        raise HTTPException(409, "Aucun lieu choisi : renseignez le lieu de vos sorties.")
    today: date = request.app.state.today()
    target, basis, planned = _pick_day(db, today, day)
    if planned is None and basis in ("today", "tomorrow", "date"):
        planned = db.scalars(
            select(PlannedSession)
            .where(PlannedSession.date == target, PlannedSession.type != "repos")
            .order_by(PlannedSession.id)
        ).first()
    try:
        forecast = _service(request).forecast(place, target)
    except NoForecastError as exc:
        raise HTTPException(404, str(exc)) from exc
    except WeatherError as exc:
        raise HTTPException(502, str(exc)) from exc
    session = (
        SessionBrief(
            date=planned.date,
            titre=planned.titre,
            type_label=TYPE_LABELS.get(planned.type, planned.type),
            duree_min=planned.duree_min,
        )
        if planned
        else None
    )
    return WeatherOut(day_basis=basis, session=session, weather=forecast)
