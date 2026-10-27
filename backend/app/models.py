from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AthleteProfile(Base):
    __tablename__ = "athlete_profile"
    __table_args__ = (CheckConstraint("id = 1", name="ck_athlete_profile_single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fc_max: Mapped[int] = mapped_column(Integer, nullable=False)
    fc_repos: Mapped[int | None] = mapped_column(Integer)
    seuil_lactique_fc: Mapped[int | None] = mapped_column(Integer)
    zones: Mapped[list[dict[str, Any]]] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Goal(Base):
    __tablename__ = "goal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nom: Mapped[str] = mapped_column(String, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    distance_km: Mapped[float | None] = mapped_column(Float)
    dplus_m: Mapped[int | None] = mapped_column(Integer)
    priorite: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


class RawPayload(Base):
    """Couche 1 : JSON brut tel que reçu de la source (jamais modifié par la normalisation)."""

    __tablename__ = "raw_payload"
    __table_args__ = (UniqueConstraint("source", "type", "external_key", name="uq_raw_payload"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)  # activity|activity_stream|wellness
    external_key: Mapped[str] = mapped_column(String, nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    hash: Mapped[str] = mapped_column(String(64), nullable=False)


class Activity(Base):
    """Couche 2 (reconstruisible depuis raw_payload). Dates en UTC naïf."""

    __tablename__ = "activity"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_activity_source_ext"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String, nullable=False)
    external_id: Mapped[str] = mapped_column(String, nullable=False)
    sport: Mapped[str] = mapped_column(String, nullable=False)
    start_utc: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    duration_s: Mapped[float] = mapped_column(Float, nullable=False)
    distance_m: Mapped[float | None] = mapped_column(Float)
    elevation_gain_m: Mapped[float | None] = mapped_column(Float)
    elevation_loss_m: Mapped[float | None] = mapped_column(Float)
    hr_avg: Mapped[int | None] = mapped_column(Integer)
    hr_max: Mapped[int | None] = mapped_column(Integer)
    calories: Mapped[int | None] = mapped_column(Integer)
    gear: Mapped[str | None] = mapped_column(String)
    dedup_group_id: Mapped[int | None] = mapped_column(Integer, index=True)


class ActivityStream(Base):
    """Échantillons en colonnes (t, fc, altitude, speed, distance, cadence), JSON zlib."""

    __tablename__ = "activity_stream"

    activity_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("activity.id", ondelete="CASCADE"), primary_key=True
    )
    samples: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)


class WellnessDaily(Base):
    __tablename__ = "wellness_daily"

    date: Mapped[date] = mapped_column(Date, primary_key=True)
    source: Mapped[str] = mapped_column(String, primary_key=True)
    hrv_nuit: Mapped[float | None] = mapped_column(Float)
    hrv_base_min: Mapped[float | None] = mapped_column(Float)
    hrv_base_max: Mapped[float | None] = mapped_column(Float)
    fc_repos: Mapped[int | None] = mapped_column(Integer)
    sommeil_duree_s: Mapped[int | None] = mapped_column(Integer)
    sommeil_efficacite: Mapped[float | None] = mapped_column(Float)
    stress: Mapped[int | None] = mapped_column(Integer)
    spo2: Mapped[float | None] = mapped_column(Float)
    training_readiness: Mapped[int | None] = mapped_column(Integer)
    body_battery_max: Mapped[int | None] = mapped_column(Integer)
    body_battery_min: Mapped[int | None] = mapped_column(Integer)
    poids_kg: Mapped[float | None] = mapped_column(Float)


class SourceStatus(Base):
    __tablename__ = "source_status"

    source: Mapped[str] = mapped_column(String, primary_key=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error_message: Mapped[str | None] = mapped_column(String)
    unavailable_since: Mapped[datetime | None] = mapped_column(DateTime)
