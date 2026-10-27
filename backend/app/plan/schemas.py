from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

SessionType = Literal[
    "footing", "cotes", "seuil", "longue", "fractionne", "course", "renfo", "repos", "autre"
]

TYPE_LABELS: dict[str, str] = {
    "footing": "Footing",
    "cotes": "Côtes",
    "seuil": "Seuil",
    "longue": "Sortie longue",
    "fractionne": "Fractionné",
    "course": "Course",
    "renfo": "Renforcement",
    "repos": "Repos",
    "autre": "Autre",
}
WEEKDAYS_FR = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]

Rating = Annotated[int, Field(ge=0, le=10)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]


# --- saisies du soir ------------------------------------------------------------------------


class SessionRpeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    activity_id: int
    rpe: Rating | None  # None : efface la saisie


class EntryIn(BaseModel):
    """Tout est optionnel ; seuls les champs fournis sont modifiés, `null` efface.

    `rpe` est le raccourci de saisie rapide : il s'applique à la séance du jour quand il n'y en a
    qu'une. Sinon, préciser les séances dans `sessions`.
    """

    model_config = ConfigDict(extra="forbid")

    courbatures: Rating | None = None
    malade: bool | None = None
    note: ShortText | None = None
    rpe: Rating | None = None
    sessions: list[SessionRpeIn] = Field(default_factory=list, max_length=10)

    @field_validator("note")
    @classmethod
    def _blank_note_is_none(cls, v: str | None) -> str | None:
        return v or None


class SessionRpeOut(BaseModel):
    activity_id: int | None
    rpe: int
    sport: str | None
    duration_min: float | None


class EntryOut(BaseModel):
    date: date
    courbatures: int | None
    malade: bool | None
    note: str | None
    sessions: list[SessionRpeOut]
    updated_at: datetime | None


# --- programme ------------------------------------------------------------------------------


class PlannedIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: date
    titre: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    type: SessionType
    objectif: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    duree_min: Annotated[int, Field(ge=1, le=1440)] | None = None
    zone_cible: Annotated[str, StringConstraints(pattern=r"^[1-5](-[1-5])?$")] | None = None
    dplus_cible: Annotated[int, Field(ge=0, le=10000)] | None = None
    consignes: ShortText | None = None

    @field_validator("zone_cible")
    @classmethod
    def _zones_ordered(cls, v: str | None) -> str | None:
        if v and "-" in v:
            low, high = v.split("-")
            if int(low) >= int(high):
                raise ValueError("zone_cible : fourchette croissante attendue (ex. « 1-2 »)")
        return v


class ActivityBrief(BaseModel):
    id: int
    sport: str
    start_utc: datetime
    duration_min: float
    distance_km: float | None
    dplus_m: float | None
    hr_avg: int | None
    is_race: bool


class PlannedOut(PlannedIn):
    id: int
    type_label: str
    status: str
    plan_id: int | None = None
    plan_nom: str | None = None


# --- plans ----------------------------------------------------------------------------------


class PlanIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nom: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    date_debut: date
    date_fin: date
    goal_id: int | None = None

    @model_validator(mode="after")
    def _ordered(self) -> "PlanIn":
        if self.date_debut > self.date_fin:
            raise ValueError("date_debut doit précéder date_fin")
        return self


class PlanCourseIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    goal_id: int | None  # None : détache le plan de sa course


class PlanOut(BaseModel):
    id: int
    nom: str
    date_debut: date
    date_fin: date
    goal_id: int | None
    goal_nom: str | None
    nb_seances: int


class PlanDeleteOut(BaseModel):
    removed: int
    kept: int  # séances déjà réalisées, conservées sans plan


class SessionMatchOut(BaseModel):
    planned: PlannedOut
    status: str
    activity: ActivityBrief | None
    duration_delta_min: float | None
    duration_ratio: float | None
    dplus_delta_m: float | None


class DayPlanOut(BaseModel):
    date: date
    weekday: str
    is_today: bool
    status: str | None
    sessions: list[SessionMatchOut]
    unplanned_activities: list[ActivityBrief]
    entry: EntryOut | None


class WeekPlanOut(BaseModel):
    week_start: date
    week_end: date
    planned_min: int
    done_min: float
    days: list[DayPlanOut]


class RaceMarkerOut(BaseModel):
    id: int
    nom: str
    date: date


class PlanBriefOut(BaseModel):
    id: int
    nom: str


class RangePlanOut(BaseModel):
    start: date
    end: date
    days: list[DayPlanOut]
    races: list[RaceMarkerOut]  # courses dont la date tombe dans la période
    plans: list[PlanBriefOut]  # plans qui ont au moins une séance dans la période
