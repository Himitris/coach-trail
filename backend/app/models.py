from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
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
    renfo_objectif_hebdo: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class Goal(Base):
    __tablename__ = "goal"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nom: Mapped[str] = mapped_column(String, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    distance_km: Mapped[float | None] = mapped_column(Float)
    dplus_m: Mapped[int | None] = mapped_column(Integer)
    priorite: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    profil_points: Mapped[list[list[float]] | None] = mapped_column(JSON)


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
    is_race: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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
    # CTL/ATL fournis par la source (Intervals.icu) : jamais utilisés, seulement comparés.
    source_ctl: Mapped[float | None] = mapped_column(Float)
    source_atl: Mapped[float | None] = mapped_column(Float)


class SourceStatus(Base):
    __tablename__ = "source_status"

    source: Mapped[str] = mapped_column(String, primary_key=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime)
    last_error_message: Mapped[str | None] = mapped_column(String)
    unavailable_since: Mapped[datetime | None] = mapped_column(DateTime)
    state: Mapped[str | None] = mapped_column(String)  # ok|degraded|auth_required|down
    message: Mapped[str | None] = mapped_column(String)  # message lisible pour l'UI


class EveningEntry(Base):
    """Saisie du soir. kind='day' : courbatures / malade / note (une par jour) ;
    kind='session' : RPE d'une séance (une par activité)."""

    __tablename__ = "evening_entry"
    __table_args__ = (
        CheckConstraint("kind IN ('day', 'session')", name="ck_entry_kind"),
        CheckConstraint(
            "(kind = 'day' AND activity_id IS NULL AND rpe IS NULL)"
            " OR (kind = 'session' AND rpe IS NOT NULL AND courbatures IS NULL"
            " AND malade IS NULL AND note IS NULL)",
            name="ck_entry_shape",
        ),
        CheckConstraint("rpe IS NULL OR (rpe >= 0 AND rpe <= 10)", name="ck_entry_rpe"),
        CheckConstraint(
            "courbatures IS NULL OR (courbatures >= 0 AND courbatures <= 10)",
            name="ck_entry_courbatures",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String, nullable=False)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    activity_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("activity.id", ondelete="SET NULL"), unique=True
    )
    # copie du début de séance : permet de rattacher à nouveau la saisie après une reconstruction
    activity_start_utc: Mapped[datetime | None] = mapped_column(DateTime)
    rpe: Mapped[int | None] = mapped_column(Integer)
    courbatures: Mapped[int | None] = mapped_column(Integer)
    malade: Mapped[bool | None] = mapped_column(Boolean)
    note: Mapped[str | None] = mapped_column(String)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class PlannedSession(Base):
    __tablename__ = "planned_session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    titre: Mapped[str] = mapped_column(String, nullable=False)
    type: Mapped[str] = mapped_column(String, nullable=False)
    objectif: Mapped[str | None] = mapped_column(String)
    duree_min: Mapped[int | None] = mapped_column(Integer)
    zone_cible: Mapped[str | None] = mapped_column(String)
    dplus_cible: Mapped[int | None] = mapped_column(Integer)
    consignes: Mapped[str | None] = mapped_column(String)


class DashboardLayoutRow(Base):
    """Document unique : pages, widgets, positions par point de rupture, réglages."""

    __tablename__ = "dashboard_layout"
    __table_args__ = (CheckConstraint("id = 1", name="ck_dashboard_layout_single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class FuelingEntry(Base):
    """Nutrition d'une sortie : glucides réellement consommés et score digestif (saisie)."""

    __tablename__ = "fueling_entry"
    __table_args__ = (
        CheckConstraint(
            "glucides_g_par_h >= 0 AND glucides_g_par_h <= 300", name="ck_fueling_carbs"
        ),
        CheckConstraint("score_digestif >= 0 AND score_digestif <= 5", name="ck_fueling_gi"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    activity_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    glucides_g_par_h: Mapped[float] = mapped_column(Float, nullable=False)
    score_digestif: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(String)
    updated_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)


class StrengthSession(Base):
    """Séance de renforcement saisie à la main (la montre ne l'a pas enregistrée)."""

    __tablename__ = "strength_session"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    duree_min: Mapped[int | None] = mapped_column(Integer)
    note: Mapped[str | None] = mapped_column(String)


class GearItem(Base):
    """Paire de chaussures : seuil d'usure réglable, kilométrage déjà parcouru avant l'appli."""

    __tablename__ = "gear_item"
    __table_args__ = (
        CheckConstraint("seuil_km >= 50 AND seuil_km <= 5000", name="ck_gear_seuil"),
        CheckConstraint("km_initial >= 0 AND km_initial <= 20000", name="ck_gear_km_initial"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    nom: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    seuil_km: Mapped[int] = mapped_column(Integer, nullable=False, default=800)
    km_initial: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    retire: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class GearAssignment(Base):
    """Affectation manuelle d'une sortie à une paire (prioritaire sur le matériel de la montre)."""

    __tablename__ = "gear_assignment"

    activity_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("activity.id", ondelete="CASCADE"), primary_key=True
    )
    gear_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("gear_item.id", ondelete="CASCADE"), nullable=False, index=True
    )
