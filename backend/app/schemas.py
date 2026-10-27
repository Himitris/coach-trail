from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    fc_max: int
    fc_repos: int | None
    seuil_lactique_fc: int | None
    zones: list[dict[str, Any]]
    updated_at: datetime


class ProfileUpdate(BaseModel):
    fc_max: int | None = Field(default=None, ge=100, le=250)
    fc_repos: int | None = Field(default=None, ge=20, le=120)
    seuil_lactique_fc: int | None = Field(default=None, ge=80, le=250)
    zones: list[dict[str, Any]] | None = None

    @model_validator(mode="after")
    def _fc_max_non_null(self) -> "ProfileUpdate":
        if "fc_max" in self.model_fields_set and self.fc_max is None:
            raise ValueError("fc_max ne peut pas être nul")
        if "zones" in self.model_fields_set and self.zones is None:
            raise ValueError("zones ne peut pas être nul")
        return self


class GoalBase(BaseModel):
    nom: str = Field(min_length=1, max_length=200)
    date: date
    distance_km: float | None = Field(default=None, gt=0)
    dplus_m: int | None = Field(default=None, ge=0)
    priorite: int = Field(default=1, ge=1, le=3)


class GoalCreate(GoalBase):
    pass


class GoalUpdate(GoalBase):
    pass


class GoalOut(GoalBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class HealthOut(BaseModel):
    status: str
    version: str
    db: str


class SourceResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    source: str
    ok: bool
    error: str | None
    fetched: int
    inserted: int
    updated: int
    unchanged: int
    streams: int
    fallback_for: str | None = None
    warnings: list[str]


class RunReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trigger: str
    started_at: datetime
    finished_at: datetime | None
    results: list[SourceResultOut]


class SyncStartedOut(BaseModel):
    started: bool


class SyncStatusOut(BaseModel):
    running: bool
    nightly_time: str
    next_run_at: datetime | None
    current: RunReportOut | None
    last_run: RunReportOut | None


class SourceHealthOut(BaseModel):
    source: str
    label: str
    state: str  # ok | degraded | auth_required | down | jamais_synchronise
    message: str | None
    last_success_at: datetime | None
    last_error_at: datetime | None
    last_error_message: str | None
    unavailable_since: datetime | None
    badge: str | None
