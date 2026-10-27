"""Saisies du soir : écriture, lecture, rattachement aux séances, lecteur sRPE (métriques)."""

from collections.abc import Sequence
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from app.metrics.service import load_rows, local_day
from app.metrics.srpe import SRPEEntry
from app.models import Activity, EveningEntry
from app.plan.schemas import EntryIn, EntryOut, SessionRpeOut

DAY_FIELDS = ("courbatures", "malade", "note")
RELINK_TOLERANCE_S = 60


class EntryError(Exception):
    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _upsert_session_rpe(session: Session, day: date, act: Activity, rpe: int) -> None:
    # une seule saisie par séance réelle, même si la montre et Intervals.icu la listent deux fois
    if act.dedup_group_id is not None:
        twins = session.scalars(
            select(Activity.id).where(
                Activity.dedup_group_id == act.dedup_group_id, Activity.id != act.id
            )
        ).all()
        if twins:
            session.execute(delete(EveningEntry).where(EveningEntry.activity_id.in_(twins)))
    row = session.scalars(select(EveningEntry).where(EveningEntry.activity_id == act.id)).first()
    if row is None:
        row = EveningEntry(kind="session", date=day, activity_id=act.id)
        session.add(row)
    row.activity_start_utc = act.start_utc
    row.rpe = rpe
    row.updated_at = _now()


def upsert_entry(
    session: Session,
    day: date,
    body: EntryIn,
    priority: Sequence[str],
    tz: ZoneInfo,
) -> EntryOut:
    """Applique les champs fournis. Lève EntryError (422) si une séance ne correspond pas."""
    fields = body.model_fields_set

    # --- jour : courbatures / malade / note
    day_row = session.scalars(
        select(EveningEntry).where(EveningEntry.kind == "day", EveningEntry.date == day)
    ).first()
    if any(f in fields for f in DAY_FIELDS):
        if day_row is None:
            day_row = EveningEntry(kind="day", date=day)
            session.add(day_row)
        for f in DAY_FIELDS:
            if f in fields:
                setattr(day_row, f, getattr(body, f))
        day_row.updated_at = _now()
        if all(getattr(day_row, f) is None for f in DAY_FIELDS):
            if day_row.id is not None:
                session.delete(day_row)
            else:
                session.expunge(day_row)

    # --- séances : RPE explicite par activité
    for item in body.sessions:
        act = session.get(Activity, item.activity_id)
        if act is None or local_day(act.start_utc, tz) != day:
            raise EntryError(
                422, f"L'activité {item.activity_id} n'existe pas ou n'a pas eu lieu le {day}."
            )
        if item.rpe is None:
            session.execute(delete(EveningEntry).where(EveningEntry.activity_id == act.id))
        else:
            _upsert_session_rpe(session, day, act, item.rpe)

    # --- raccourci `rpe` : séance unique du jour
    if "rpe" in fields:
        if body.rpe is None:
            session.execute(
                delete(EveningEntry).where(EveningEntry.kind == "session", EveningEntry.date == day)
            )
        else:
            todays = [r for r in load_rows(session, priority, tz) if r.day == day]
            if not todays:
                raise EntryError(422, f"Aucune séance le {day} : rien à noter.")
            if len(todays) > 1:
                raise EntryError(
                    422,
                    f"Plusieurs séances le {day} : indiquer l'activité dans « sessions ».",
                )
            act = session.get(Activity, todays[0].id)
            if act is None:  # pragma: no cover  (course entre lecture et écriture)
                raise EntryError(422, "Séance introuvable.")
            _upsert_session_rpe(session, day, act, body.rpe)

    session.flush()
    session.commit()
    entries = read_entries(session, day, day)
    return (
        entries[0]
        if entries
        else EntryOut(
            date=day, courbatures=None, malade=None, note=None, sessions=[], updated_at=None
        )
    )


def read_entries(session: Session, start: date, end: date) -> list[EntryOut]:
    rows = session.scalars(
        select(EveningEntry)
        .where(EveningEntry.date >= start, EveningEntry.date <= end)
        .order_by(EveningEntry.date, EveningEntry.id)
    ).all()
    activities = {
        a.id: a
        for a in session.scalars(
            select(Activity).where(Activity.id.in_([r.activity_id for r in rows if r.activity_id]))
        )
    }
    by_day: dict[date, EntryOut] = {}
    for row in rows:
        entry = by_day.setdefault(
            row.date,
            EntryOut(
                date=row.date,
                courbatures=None,
                malade=None,
                note=None,
                sessions=[],
                updated_at=None,
            ),
        )
        if row.kind == "day":
            entry.courbatures, entry.malade, entry.note = row.courbatures, row.malade, row.note
        elif row.rpe is not None:
            act = activities.get(row.activity_id) if row.activity_id else None
            entry.sessions.append(
                SessionRpeOut(
                    activity_id=row.activity_id,
                    rpe=row.rpe,
                    sport=act.sport if act else None,
                    duration_min=act.duration_s / 60 if act else None,
                )
            )
        if entry.updated_at is None or row.updated_at > entry.updated_at:
            entry.updated_at = row.updated_at
    return list(by_day.values())


def relink_entries(session: Session) -> int:
    """Rattache les saisies RPE orphelines (activité reconstruite) via le début de séance."""
    relinked = 0
    orphans = session.scalars(
        select(EveningEntry).where(
            EveningEntry.kind == "session",
            EveningEntry.activity_id.is_(None),
            EveningEntry.activity_start_utc.is_not(None),
        )
    ).all()
    for row in orphans:
        assert row.activity_start_utc is not None  # noqa: S101
        window = timedelta(seconds=RELINK_TOLERANCE_S)
        candidates = session.scalars(
            select(Activity)
            .where(
                Activity.start_utc >= row.activity_start_utc - window,
                Activity.start_utc <= row.activity_start_utc + window,
            )
            .order_by(Activity.id)
        ).all()
        taken = {
            r
            for r in session.scalars(
                select(EveningEntry.activity_id).where(EveningEntry.activity_id.is_not(None))
            )
        }
        free = [a for a in candidates if a.id not in taken]
        if free:
            row.activity_id = free[0].id
            relinked += 1
            session.flush()
    return relinked


class DbEntryReader:
    """Lecteur sRPE branché sur `evening_entry` (remplace NullEntryReader)."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._factory = session_factory

    def read_srpe(self, start: date, end: date) -> list[SRPEEntry]:
        with self._factory() as session:
            rows = session.execute(
                select(EveningEntry, Activity)
                .join(Activity, Activity.id == EveningEntry.activity_id)
                .where(
                    EveningEntry.kind == "session",
                    EveningEntry.rpe.is_not(None),
                    EveningEntry.date >= start,
                    EveningEntry.date <= end,
                )
                .order_by(EveningEntry.date, EveningEntry.id)
            ).all()
            return [
                SRPEEntry(
                    day=entry.date,
                    rpe=float(entry.rpe or 0),
                    duration_min=act.duration_s / 60,
                    activity_id=act.id,
                )
                for entry, act in rows
            ]
