"""Import d'un plan JSON (produit par Claude) : validation stricte, aperçu, enregistrement.

Format (voir `docs/plan-schema.json`, `version: 1`) : `{"version": 1, "sessions": [...]}` ou une
liste de séances. Règle de remplacement : pour chaque jour présent dans le fichier, les séances du
fichier remplacent celles déjà prévues ce jour-là ; un jour déjà identique ne change pas (import
idempotent).
Un jour passé dont la séance prévue est déjà réalisée (fait / partiel) n'est jamais touché sans
confirmation explicite (`confirm_past_done`).
"""

import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import PlannedSession
from app.plan.matching import FAIT, PARTIEL
from app.plan.schemas import TYPE_LABELS
from app.plan.service import match_planned, status_by_id

SCHEMA_VERSION = 1
MAX_SESSIONS = 400
PAST_DAYS = 365
FUTURE_DAYS = 730
FIELDS = (
    "date",
    "type",
    "titre",
    "duree_min",
    "zone_cible",
    "dplus_cible",
    "objectif",
    "consignes",
)
TYPES = tuple(TYPE_LABELS)
ZONE_RE = re.compile(r"^[1-5](-[1-5])?$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ImportIssue(BaseModel):
    session: int | None  # numéro de la séance dans le fichier (à partir de 1)
    field: str | None
    message: str


@dataclass(frozen=True)
class PlanLine:
    titre: str
    type: str
    objectif: str | None
    duree_min: int | None
    zone_cible: str | None
    dplus_cible: int | None
    consignes: str | None


class PlanLineOut(BaseModel):
    titre: str
    type: str
    type_label: str
    objectif: str | None
    duree_min: int | None
    zone_cible: str | None
    dplus_cible: int | None
    consignes: str | None


def line_out(line: PlanLine) -> PlanLineOut:
    return PlanLineOut(
        titre=line.titre,
        type=line.type,
        type_label=TYPE_LABELS.get(line.type, line.type),
        objectif=line.objectif,
        duree_min=line.duree_min,
        zone_cible=line.zone_cible,
        dplus_cible=line.dplus_cible,
        consignes=line.consignes,
    )


DayAction = Literal["create", "replace", "unchanged", "blocked"]


class DayChange(BaseModel):
    date: date
    action: DayAction
    reason: str | None = None
    existing: list[PlanLineOut]
    incoming: list[PlanLineOut]


class ImportSummary(BaseModel):
    sessions_in_file: int
    days_in_file: int
    created_days: int
    replaced_days: int
    unchanged_days: int
    blocked_days: int
    sessions_added: int
    sessions_removed: int


class ImportReport(BaseModel):
    dry_run: bool
    applied: bool
    summary: ImportSummary
    days: list[DayChange]


def _type_name(value: Any) -> str:
    return type(value).__name__ if value is not None else "null"


def _int(value: Any, lo: int, hi: int) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if lo <= value <= hi else None


def _text(value: Any, field: str, limit: int, issues: list[ImportIssue], n: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        issues.append(
            ImportIssue(session=n, field=field, message=f"« {field} » doit être un texte.")
        )
        return None
    stripped = value.strip()
    if len(stripped) > limit:
        issues.append(
            ImportIssue(session=n, field=field, message=f"« {field} » dépasse {limit} caractères.")
        )
        return None
    return stripped or None


def parse_session(
    raw: Any, n: int, today: date, issues: list[ImportIssue]
) -> tuple[date, PlanLine] | None:
    """Une séance du fichier ; les erreurs sont ajoutées à `issues` (toutes, pas la première)."""
    if not isinstance(raw, dict):
        issues.append(
            ImportIssue(session=n, field=None, message="Une séance doit être un objet JSON.")
        )
        return None
    before = len(issues)
    for key in raw:
        if key not in FIELDS:
            issues.append(
                ImportIssue(
                    session=n,
                    field=str(key),
                    message=f"Champ inconnu « {key} » (champs autorisés : {', '.join(FIELDS)}).",
                )
            )

    day: date | None = None
    raw_date = raw.get("date")
    if not isinstance(raw_date, str) or not DATE_RE.match(raw_date):
        issues.append(
            ImportIssue(
                session=n, field="date", message="« date » est obligatoire, au format AAAA-MM-JJ."
            )
        )
    else:
        try:
            day = date.fromisoformat(raw_date)
        except ValueError:
            issues.append(
                ImportIssue(
                    session=n, field="date", message=f"« {raw_date} » n'est pas une date valide."
                )
            )
        else:
            if not today - timedelta(days=PAST_DAYS) <= day <= today + timedelta(days=FUTURE_DAYS):
                issues.append(
                    ImportIssue(
                        session=n,
                        field="date",
                        message=f"« {raw_date} » est trop loin dans le passé ou le futur.",
                    )  # fmt: skip
                )
                day = None

    session_type = raw.get("type")
    if session_type not in TYPES:
        issues.append(
            ImportIssue(
                session=n,
                field="type",
                message=(
                    f"« type » est obligatoire parmi : {', '.join(TYPES)} "
                    f"(reçu : {raw.get('type')!r})."
                ),
            )  # fmt: skip
        )

    duree = raw.get("duree_min")
    if duree is not None and _int(duree, 1, 1440) is None:
        issues.append(
            ImportIssue(
                session=n,
                field="duree_min",
                message=(
                    "« duree_min » doit être un entier de minutes entre 1 et 1440 "
                    f"(reçu : {duree!r})."
                ),
            )  # fmt: skip
        )
    dplus = raw.get("dplus_cible")
    if dplus is not None and _int(dplus, 0, 10000) is None:
        issues.append(
            ImportIssue(
                session=n,
                field="dplus_cible",
                message=(
                    "« dplus_cible » doit être un entier de mètres entre 0 et 10000 "
                    f"(reçu : {dplus!r})."
                ),
            )  # fmt: skip
        )
    zone = raw.get("zone_cible")
    if zone is not None:
        ok = isinstance(zone, str) and bool(ZONE_RE.match(zone))
        if ok and "-" in zone:
            low, high = zone.split("-")
            ok = int(low) < int(high)
        if not ok:
            issues.append(
                ImportIssue(
                    session=n,
                    field="zone_cible",
                    message=(
                        f"« zone_cible » doit être un texte « 2 » ou « 1-2 » (zones 1 à 5, "
                        "fourchette "
                        f"croissante) ; reçu : {zone!r}."
                    ),
                )  # fmt: skip
            )

    titre = _text(raw.get("titre"), "titre", 120, issues, n)
    objectif = _text(raw.get("objectif"), "objectif", 500, issues, n)
    consignes = _text(raw.get("consignes"), "consignes", 2000, issues, n)

    if len(issues) > before or day is None or session_type not in TYPES:
        return None
    return day, PlanLine(
        titre=titre or TYPE_LABELS[session_type],
        type=session_type,
        objectif=objectif,
        duree_min=_int(duree, 1, 1440),
        zone_cible=zone,
        dplus_cible=_int(dplus, 0, 10000),
        consignes=consignes,
    )


def parse_document(data: Any, today: date) -> tuple[list[tuple[date, PlanLine]], list[ImportIssue]]:
    issues: list[ImportIssue] = []
    if isinstance(data, dict):
        version = data.get("version", SCHEMA_VERSION)
        if version != SCHEMA_VERSION:
            issues.append(
                ImportIssue(
                    session=None,
                    field="version",
                    message=(
                        f"Version de plan non prise en charge : {version!r} "
                        f"(attendu : {SCHEMA_VERSION})."
                    ),
                )  # fmt: skip
            )
        for key in data:
            if key not in ("version", "sessions"):
                issues.append(
                    ImportIssue(
                        session=None,
                        field=str(key),
                        message=f"Champ inconnu « {key} » à la racine.",
                    )
                )
        sessions = data.get("sessions")
    else:
        sessions = data
    if not isinstance(sessions, list):
        issues.append(
            ImportIssue(
                session=None,
                field="sessions",
                message=(
                    "Le plan doit contenir une liste « sessions » (ou être lui-même une liste)."
                ),
            )  # fmt: skip
        )
        return [], issues
    if not sessions:
        issues.append(
            ImportIssue(session=None, field="sessions", message="La liste de séances est vide.")
        )
    if len(sessions) > MAX_SESSIONS:
        issues.append(
            ImportIssue(
                session=None, field="sessions", message=f"Plan limité à {MAX_SESSIONS} séances."
            )
        )
        return [], issues
    parsed: list[tuple[date, PlanLine]] = []
    seen: Counter[tuple[date, PlanLine]] = Counter()
    for i, raw in enumerate(sessions, start=1):
        item = parse_session(raw, i, today, issues)
        if item is not None:
            seen[item] += 1
            if seen[item] > 1:
                issues.append(
                    ImportIssue(
                        session=i, field=None, message="Séance en double (même jour, mêmes champs)."
                    )
                )
            parsed.append(item)
    return parsed, issues


def _line(p: PlannedSession) -> PlanLine:
    return PlanLine(
        p.titre, p.type, p.objectif, p.duree_min, p.zone_cible, p.dplus_cible, p.consignes
    )


def _key(line: PlanLine) -> tuple[str, ...]:
    return tuple("" if v is None else str(v) for v in (
        line.type, line.titre, line.duree_min, line.zone_cible,
        line.dplus_cible, line.objectif, line.consignes,
    ))  # fmt: skip


def plan_import(
    session: Session,
    parsed: Sequence[tuple[date, PlanLine]],
    *,
    today: date,
    priority: Sequence[str],
    tz: ZoneInfo,
    dry_run: bool,
    confirm_past_done: bool,
) -> ImportReport:
    by_day: dict[date, list[PlanLine]] = {}
    for day, line in parsed:
        by_day.setdefault(day, []).append(line)
    existing_rows = list(
        session.scalars(
            select(PlannedSession)
            .where(PlannedSession.date.in_(list(by_day)))
            .order_by(PlannedSession.date, PlannedSession.id)
        )
    )
    existing: dict[date, list[PlannedSession]] = {}
    for row in existing_rows:
        existing.setdefault(row.date, []).append(row)
    past = [r for r in existing_rows if r.date < today]
    done_days: set[date] = set()
    if past:
        results = status_by_id(match_planned(session, priority, tz, today, past))
        done_days = {
            r.date for r in past if r.id in results and results[r.id].status in (FAIT, PARTIEL)
        }

    days: list[DayChange] = []
    added = removed = 0
    to_replace: list[date] = []
    for day in sorted(by_day):
        incoming = by_day[day]
        current = existing.get(day, [])
        current_lines = [_line(p) for p in current]
        if not current:
            action: DayAction = "create"
            reason = None
        elif sorted(map(_key, current_lines)) == sorted(map(_key, incoming)):
            action, reason = "unchanged", None
        elif day in done_days and not confirm_past_done:
            action = "blocked"
            reason = "Jour passé avec une séance déjà réalisée : confirmation explicite nécessaire."
        else:
            action, reason = "replace", None
        if action in ("create", "replace"):
            to_replace.append(day)
            added += len(incoming)
            removed += len(current)
        days.append(
            DayChange(
                date=day,
                action=action,
                reason=reason,
                existing=[line_out(x) for x in current_lines],
                incoming=[line_out(x) for x in incoming],
            )
        )

    applied = False
    if not dry_run and to_replace:
        session.execute(delete(PlannedSession).where(PlannedSession.date.in_(to_replace)))
        for day in to_replace:
            for line in by_day[day]:
                session.add(
                    PlannedSession(
                        date=day,
                        titre=line.titre,
                        type=line.type,
                        objectif=line.objectif,
                        duree_min=line.duree_min,
                        zone_cible=line.zone_cible,
                        dplus_cible=line.dplus_cible,
                        consignes=line.consignes,
                    )  # fmt: skip
                )
        session.commit()
        applied = True
    counts = Counter(d.action for d in days)
    return ImportReport(
        dry_run=dry_run,
        applied=applied,
        summary=ImportSummary(
            sessions_in_file=len(parsed),
            days_in_file=len(by_day),
            created_days=counts["create"],
            replaced_days=counts["replace"],
            unchanged_days=counts["unchanged"],
            blocked_days=counts["blocked"],
            sessions_added=added,
            sessions_removed=removed,
        ),
        days=days,
    )
