"""Import d'un plan JSON (produit par Claude) : validation stricte, aperçu, enregistrement.

Format (voir `docs/plan-schema.json`) : version 1 `{"version": 1, "sessions": [...]}` (ou une
liste de séances) ; version 2 ajoute `"plan": {"nom": ..., "course": ...}`. Les séances importées
sont rattachées à un plan (créé, ou retrouvé par son nom : réimporter met le plan à jour).
Règle de remplacement : pour chaque jour présent dans le fichier, les séances du fichier remplacent
celles déjà prévues ce jour-là ; un jour déjà identique ne change pas (import idempotent).
Un jour passé dont la séance prévue est déjà réalisée (fait / partiel) n'est jamais touché sans
confirmation explicite (`confirm_past_done`) ; un jour qui appartient à un autre plan non plus
(`confirm_overlap`).
"""

import re
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Goal, Plan, PlannedSession
from app.plan.matching import FAIT, PARTIEL
from app.plan.plans import refresh_bounds, resolve_course
from app.plan.schemas import TYPE_LABELS
from app.plan.service import match_planned, status_by_id

SCHEMA_VERSION = 1
SUPPORTED_VERSIONS = (1, 2)
MAX_PLAN_NAME = 120
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


DayAction = Literal["create", "replace", "unchanged", "blocked", "overlap"]


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
    overlap_days: int = 0
    sessions_added: int
    sessions_removed: int


class PlanInfo(BaseModel):
    """Plan visé par l'import : existant (mise à jour) ou à créer."""

    nom: str
    action: Literal["create", "update"]
    plan_id: int | None = None
    course_id: int | None = None
    course_nom: str | None = None
    course_asked: str | None = None  # course demandée dans le fichier (même non reconnue)
    date_debut: date
    date_fin: date


class ImportReport(BaseModel):
    dry_run: bool
    applied: bool
    plan: PlanInfo | None = None
    warnings: list[str] = []
    summary: ImportSummary
    days: list[DayChange]


@dataclass(frozen=True)
class PlanMeta:
    nom: str | None = None
    course: str | None = None


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


def _parse_meta(raw: Any, issues: list[ImportIssue]) -> PlanMeta:
    if not isinstance(raw, dict):
        issues.append(
            ImportIssue(
                session=None, field="plan", message="« plan » doit être un objet {nom, course}."
            )
        )
        return PlanMeta()
    for key in raw:
        if key not in ("nom", "course"):
            issues.append(
                ImportIssue(
                    session=None,
                    field=f"plan.{key}",
                    message=f"Champ inconnu « {key} » dans « plan » (autorisés : nom, course).",
                )
            )
    values: dict[str, str | None] = {}
    for key, limit in (("nom", MAX_PLAN_NAME), ("course", 200)):
        value = raw.get(key)
        if value is None:
            values[key] = None
        elif not isinstance(value, str) or not value.strip() or len(value.strip()) > limit:
            issues.append(
                ImportIssue(
                    session=None,
                    field=f"plan.{key}",
                    message=f"« plan.{key} » doit être un texte de 1 à {limit} caractères.",
                )
            )
            values[key] = None
        else:
            values[key] = value.strip()
    return PlanMeta(nom=values["nom"], course=values["course"])


def parse_document(
    data: Any, today: date
) -> tuple[list[tuple[date, PlanLine]], list[ImportIssue], PlanMeta]:
    issues: list[ImportIssue] = []
    meta = PlanMeta()
    if isinstance(data, dict):
        version = data.get("version", SCHEMA_VERSION)
        if version not in SUPPORTED_VERSIONS or isinstance(version, bool):
            issues.append(
                ImportIssue(
                    session=None,
                    field="version",
                    message=(
                        f"Version de plan non prise en charge : {version!r} "
                        f"(attendues : {', '.join(map(str, SUPPORTED_VERSIONS))})."
                    ),
                )  # fmt: skip
            )
        for key in data:
            if key not in ("version", "sessions", "plan"):
                issues.append(
                    ImportIssue(
                        session=None,
                        field=str(key),
                        message=f"Champ inconnu « {key} » à la racine.",
                    )
                )
        if "plan" in data:
            if version == 2:
                meta = _parse_meta(data["plan"], issues)
            else:
                issues.append(
                    ImportIssue(
                        session=None,
                        field="plan",
                        message='« plan » demande "version": 2 à la racine du fichier.',
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
        return [], issues, meta
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
        return [], issues, meta
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
    return parsed, issues, meta


def _line(p: PlannedSession) -> PlanLine:
    return PlanLine(
        p.titre, p.type, p.objectif, p.duree_min, p.zone_cible, p.dplus_cible, p.consignes
    )


def _key(line: PlanLine) -> tuple[str, ...]:
    return tuple("" if v is None else str(v) for v in (
        line.type, line.titre, line.duree_min, line.zone_cible,
        line.dplus_cible, line.objectif, line.consignes,
    ))  # fmt: skip


def _foreign(row: PlannedSession, target_id: int | None) -> bool:
    """Séance rattachée à un autre plan (les séances saisies à la main, sans plan, sont libres)."""
    return row.plan_id is not None and row.plan_id != target_id


def plan_import(
    session: Session,
    parsed: Sequence[tuple[date, PlanLine]],
    *,
    today: date,
    priority: Sequence[str],
    tz: ZoneInfo,
    dry_run: bool,
    confirm_past_done: bool,
    confirm_overlap: bool = False,
    meta: PlanMeta | None = None,
) -> ImportReport:
    meta = meta or PlanMeta()
    by_day: dict[date, list[PlanLine]] = {}
    for day, line in parsed:
        by_day.setdefault(day, []).append(line)
    first, last = min(by_day), max(by_day)
    nom = meta.nom or f"Plan du {first:%d/%m/%Y}"
    target = session.scalars(select(Plan).where(func.lower(Plan.nom) == nom.lower())).first()
    target_id = target.id if target else None
    existed = target is not None
    goal = resolve_course(session, meta.course) if meta.course else None
    warnings: list[str] = []
    if meta.course and goal is None:
        warnings.append(
            f"Course « {meta.course} » non reconnue : le plan ne sera lié à aucune course "
            "(à attribuer ensuite dans la page Courses)."
        )

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
        reason = None
        if not current:
            action: DayAction = "create"
        elif sorted(map(_key, current_lines)) == sorted(map(_key, incoming)):
            action = "unchanged"
        elif day in done_days and not confirm_past_done:
            action = "blocked"
            reason = "Jour passé avec une séance déjà réalisée : confirmation explicite nécessaire."
        elif any(_foreign(p, target_id) for p in current) and not confirm_overlap:
            action = "overlap"
            names = sorted(
                {p.plan.nom for p in current if p.plan is not None and _foreign(p, target_id)}
            )
            reason = (
                f"Ce jour appartient à un autre plan ({', '.join(names)}) : "
                "confirmation nécessaire."
            )
        else:
            action = "replace"
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
    plan_id = target_id
    if not dry_run and to_replace:
        if target is None:
            target = Plan(
                nom=nom,
                date_debut=first,
                date_fin=last,
                goal_id=goal.id if goal else None,
            )
            session.add(target)
            session.flush()
        elif goal is not None:
            target.goal_id = goal.id
        plan_id = target.id
        touched = {p.plan_id for d in to_replace for p in existing.get(d, [])}
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
                        plan_id=plan_id,
                    )  # fmt: skip
                )
        session.flush()
        for pid in touched | {plan_id}:
            refresh_bounds(session, pid)
        session.commit()
        applied = True
    counts = Counter(d.action for d in days)
    return ImportReport(
        dry_run=dry_run,
        applied=applied,
        plan=PlanInfo(
            nom=target.nom if target else nom,
            action="update" if existed else "create",
            plan_id=plan_id,
            course_id=(goal.id if goal else (target.goal_id if target else None)),
            course_nom=_course_name(session, goal, target),
            course_asked=meta.course,
            date_debut=min(first, target.date_debut) if target else first,
            date_fin=max(last, target.date_fin) if target else last,
        ),
        warnings=warnings,
        summary=ImportSummary(
            sessions_in_file=len(parsed),
            days_in_file=len(by_day),
            created_days=counts["create"],
            replaced_days=counts["replace"],
            unchanged_days=counts["unchanged"],
            blocked_days=counts["blocked"],
            overlap_days=counts["overlap"],
            sessions_added=added,
            sessions_removed=removed,
        ),
        days=days,
    )


def _course_name(session: Session, goal: Goal | None, target: Plan | None) -> str | None:
    if goal is not None:
        return goal.nom
    if target is not None and target.goal_id is not None:
        linked = session.get(Goal, target.goal_id)
        return linked.nom if linked else None
    return None
