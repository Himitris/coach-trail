from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, CheckConstraint, Date, DateTime, Float, Integer, String
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
