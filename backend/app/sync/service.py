import hashlib
import json
import logging
import threading
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from itertools import batched
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session, sessionmaker

from app.logging import SecretMaskingFilter
from app.models import (
    Activity,
    ActivityStream,
    AthleteProfile,
    RawPayload,
    SourceStatus,
    WellnessDaily,
)
from app.plan.entries import relink_entries
from app.sync.dedup import assign_dedup_groups
from app.sync.streams import encode_stream
from app.sync.types import (
    RAW_ACTIVITY,
    RAW_CALENDAR,
    RAW_PROFILE,
    RAW_STREAM,
    RAW_WELLNESS,
    STATE_AUTH_REQUIRED,
    STATE_DEGRADED,
    STATE_DOWN,
    STATE_OK,
    NormalizedActivity,
    NormalizedProfile,
    RawRecord,
    SourceConnector,
    SourceError,
    SourceNormalizer,
)

BATCH_SIZE = 25
MAX_CONSECUTIVE_STREAM_FAILURES = 3
CHECK_TRIGGER = "check"  # vérification rapide : seulement les activités récentes
CHECK_MARGIN = timedelta(days=1)

logger = logging.getLogger(__name__)


class SyncBusyError(Exception):
    """Une synchronisation est déjà en cours."""


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _to_utc_naive(dt: datetime) -> datetime:
    return dt.astimezone(UTC).replace(tzinfo=None) if dt.tzinfo else dt


def payload_hash(payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()


@dataclass
class SourceResult:
    source: str
    ok: bool = True
    error: str | None = None
    fetched: int = 0
    inserted: int = 0
    updated: int = 0
    unchanged: int = 0
    streams: int = 0
    fallback_for: str | None = None  # source principale remplacée par ce run
    warnings: list[str] = field(default_factory=list)


@dataclass
class RunReport:
    trigger: str
    started_at: datetime
    finished_at: datetime | None = None
    results: list[SourceResult] = field(default_factory=list)


# --- normalisation (couche 2, reconstruisible depuis les bruts) -------------------------------


def _apply_activity(session: Session, source: str, n: NormalizedActivity) -> Activity:
    act = session.scalars(
        select(Activity).where(Activity.source == source, Activity.external_id == n.external_id)
    ).first()
    if act is None:
        act = Activity(source=source, external_id=n.external_id)
        session.add(act)
    act.sport = n.sport
    act.start_utc = _to_utc_naive(n.start)
    act.duration_s = n.duration_s
    act.distance_m = n.distance_m
    act.elevation_gain_m = n.elevation_gain_m
    act.elevation_loss_m = n.elevation_loss_m
    act.hr_avg = n.hr_avg
    act.hr_max = n.hr_max
    act.calories = n.calories
    if n.gear is not None:
        act.gear = n.gear
    if n.is_race:  # la synchro ne retire jamais un drapeau posé à la main
        act.is_race = True
    session.flush()
    return act


def _apply_profile(session: Session, n: NormalizedProfile) -> None:
    """Met à jour athlete_profile avec les valeurs fournies (jamais fc_max). Ignore les absentes."""
    profile = session.get(AthleteProfile, 1)
    if profile is None:
        return
    changed = False
    if n.fc_repos and profile.fc_repos != n.fc_repos:
        profile.fc_repos = n.fc_repos
        changed = True
    if n.seuil_lactique_fc and profile.seuil_lactique_fc != n.seuil_lactique_fc:
        profile.seuil_lactique_fc = n.seuil_lactique_fc
        changed = True
    if n.zones and profile.zones != n.zones:
        profile.zones = n.zones
        changed = True
    if changed:
        profile.updated_at = utcnow()


def normalize_raw(
    session: Session,
    raw: RawPayload,
    normalizers: Mapping[str, SourceNormalizer],
    seen_activities: set[int] | None = None,
) -> bool:
    """Applique le brut aux tables normalisées. False si la source n'a pas de normaliseur."""
    norm = normalizers.get(raw.source)
    if norm is None:
        return False
    if not raw.payload:  # marqueur « pas de données » (ex. activité sans flux)
        return True
    if raw.type == RAW_ACTIVITY:
        activity = norm.activity(raw.payload)
        if activity is not None:
            saved = _apply_activity(session, raw.source, activity)
            if seen_activities is not None:
                seen_activities.add(saved.id)
    elif raw.type == RAW_STREAM:
        stream = norm.stream(raw.payload)
        act = session.scalars(
            select(Activity).where(
                Activity.source == raw.source, Activity.external_id == raw.external_key
            )
        ).first()
        if stream is not None and act is not None:
            session.flush()
            blob = encode_stream(stream.samples)
            existing = session.get(ActivityStream, act.id)
            if existing is None:
                session.add(ActivityStream(activity_id=act.id, samples=blob))
            else:
                existing.samples = blob
    elif raw.type == RAW_PROFILE:
        profile = norm.profile(raw.payload) if norm.profile else None
        if profile is not None:
            _apply_profile(session, profile)
    elif raw.type == RAW_WELLNESS:
        w = norm.wellness(raw.payload)
        if w is not None:
            row = session.get(WellnessDaily, (w.date, raw.source))
            if row is None:
                row = WellnessDaily(date=w.date, source=raw.source)
                session.add(row)
            for name in (
                "hrv_nuit",
                "hrv_base_min",
                "hrv_base_max",
                "fc_repos",
                "sommeil_duree_s",
                "sommeil_efficacite",
                "stress",
                "spo2",
                "training_readiness",
                "body_battery_max",
                "body_battery_min",
                "poids_kg",
                "source_ctl",
                "source_atl",
            ):
                setattr(row, name, getattr(w, name))
    return True


def rebuild_normalized(
    session: Session, normalizers: Mapping[str, SourceNormalizer]
) -> dict[str, int]:
    """Reconstruit les tables normalisées depuis raw_payload, sans appeler les API.

    Les activités sont mises à jour sur place (identifiants conservés : saisies du soir, matériel
    et drapeau « course » restent rattachés) ; seules celles qui n'ont plus de brut sont retirées.
    """
    before = set(session.scalars(select(Activity.id)))
    seen: set[int] = set()
    session.execute(delete(ActivityStream))
    session.execute(delete(WellnessDaily))
    session.flush()
    counts = {"activities": 0, "streams": 0, "wellness": 0, "skipped": 0}
    # Activités d'abord : les flux s'y rattachent.
    for raw_type, label in (
        (RAW_ACTIVITY, "activities"),
        (RAW_STREAM, "streams"),
        (RAW_WELLNESS, "wellness"),
    ):
        raws = session.scalars(
            select(RawPayload).where(RawPayload.type == raw_type).order_by(RawPayload.id)
        )
        for raw in raws:
            if normalize_raw(session, raw, normalizers, seen):
                counts[label] += 1
            else:
                counts["skipped"] += 1
        session.flush()
    stale = before - seen
    if stale:
        session.execute(delete(Activity).where(Activity.id.in_(stale)))
    assign_dedup_groups(session)
    relink_entries(session)
    session.commit()
    return counts


# --- service ----------------------------------------------------------------------------------


class SyncService:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        connectors: Mapping[str, SourceConnector],
        normalizers: Mapping[str, SourceNormalizer],
        *,
        priority: Sequence[str] = ("garmin", "intervals", "strava"),
        fallbacks: Mapping[str, str] | None = None,
        overlap_days: int = 3,
        secrets: Sequence[str] = (),
    ) -> None:
        self._factory = session_factory
        self.connectors = dict(connectors)
        self.normalizers = dict(normalizers)
        self.priority = list(priority)
        # source principale -> source de repli (n'est appelée que si la principale échoue)
        self.fallbacks = {p: b for p, b in (fallbacks or {}).items() if b in self.connectors}
        self._overlap = timedelta(days=overlap_days)
        self._masker = SecretMaskingFilter(list(secrets))
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self.last_report: RunReport | None = None
        self.current: RunReport | None = None

    @property
    def running(self) -> bool:
        return self._lock.locked()

    # exécution -------------------------------------------------------------------------------

    def run_all(self, trigger: str = "manual") -> RunReport:
        """Exécution bloquante. Lève SyncBusyError si un run est déjà en cours."""
        if not self._lock.acquire(blocking=False):
            raise SyncBusyError
        try:
            return self._run_locked(trigger)
        finally:
            self._lock.release()

    def start_async(self, trigger: str = "manual") -> bool:
        """Lance un run en arrière-plan. False si un run est déjà en cours."""
        if not self._lock.acquire(blocking=False):
            return False

        def target() -> None:
            try:
                self._run_locked(trigger)
            except Exception:
                logger.exception("Échec inattendu de la synchronisation")
            finally:
                self._lock.release()

        self._thread = threading.Thread(target=target, name="sync", daemon=True)
        self._thread.start()
        return True

    def wait(self, timeout: float | None = None) -> None:
        if self._thread is not None:
            self._thread.join(timeout)

    def _run_locked(self, trigger: str) -> RunReport:
        check = trigger == CHECK_TRIGGER
        report = RunReport(trigger=trigger, started_at=utcnow())
        self.current = report
        try:
            standby = set(self.fallbacks.values())
            for name in self.connectors:
                if name in standby:
                    continue  # appelée seulement si sa source principale échoue
                result = self.sync_source(name, check=check)
                report.results.append(result)
                backup = self.fallbacks.get(name)
                if backup is not None and not result.ok:
                    report.results.append(self._fallback(name, backup, check=check))
        finally:
            report.finished_at = utcnow()
            self.last_report = report
            self.current = None
        return report

    # une source ------------------------------------------------------------------------------

    def _fallback(self, primary: str, backup: str, *, check: bool = False) -> SourceResult:
        """Bascule silencieuse : la source de repli comble la période où la principale manque.

        Aucune erreur n'est levée (le résultat porte l'échec éventuel). Au retour de la principale,
        son prochain run repart de sa dernière réussite : les jours manquants sont comblés.
        """
        with self._factory() as session:
            status = session.get(SourceStatus, primary)
            gap_start = (
                (status.last_success_at - self._overlap)
                if status and status.last_success_at
                else None
            )
        logger.warning("Source %s indisponible : bascule sur %s", primary, backup)
        return self.sync_source(backup, fallback_for=primary, since_floor=gap_start, check=check)

    def sync_source(
        self,
        name: str,
        *,
        fallback_for: str | None = None,
        since_floor: datetime | None = None,
        check: bool = False,
    ) -> SourceResult:
        result = SourceResult(source=name, fallback_for=fallback_for)
        try:
            self._sync_source(name, result, since_floor, check)
        except Exception as exc:
            if isinstance(exc, SourceError):
                state, message = exc.state, exc.user_message
            else:
                state = STATE_DOWN
                message = self._masker.mask(f"{type(exc).__name__}: {exc}")[:500]
            result.ok = False
            result.error = message
            logger.warning("Source %s en échec (%s) : %s", name, state, message)
            self._record_failure(name, state, message)
        else:
            # Une vérification rapide ne touche pas au curseur : la synchro nocturne comble tout.
            if not check:
                self._record_success(name, result.warnings)
        return result

    @staticmethod
    def _since(
        last: datetime | None, progress: datetime | None, overlap: timedelta
    ) -> datetime | None:
        """Reprise : dernière réussite ou, après un échec partiel, dernière donnée reçue."""
        candidates = [x - overlap for x in (last, progress) if x is not None]
        return max(candidates) if candidates else None

    @staticmethod
    def _progress(session: Session, name: str) -> tuple[datetime | None, datetime | None]:
        act = session.scalar(select(func.max(Activity.start_utc)).where(Activity.source == name))
        day = session.scalar(
            select(func.max(WellnessDaily.date)).where(WellnessDaily.source == name)
        )
        return act, (datetime.combine(day, datetime.min.time()) if day else None)

    def _sync_source(
        self,
        name: str,
        result: SourceResult,
        since_floor: datetime | None = None,
        check: bool = False,
    ) -> None:
        connector = self.connectors[name]
        health = connector.healthcheck()  # peut lever SourceError (ex. auth_required)
        if not health.ok:
            raise SourceError(STATE_DOWN, health.message or "Contrôle de santé en échec")

        with self._factory() as session:
            status = session.get(SourceStatus, name)
            last = status.last_success_at if status else None
            act_progress, well_progress = self._progress(session, name)
            latest = session.scalar(select(func.max(Activity.start_utc)))
        if check and latest is not None:
            # Vérification rapide : seulement le plus récent que la dernière activité connue.
            started = utcnow()
            since = latest - CHECK_MARGIN
            if since_floor is not None:
                since = max(since, since_floor)
            try:
                self._ingest(name, RAW_ACTIVITY, connector.fetch_activities(since), result)
                self._sync_streams(name, connector, result, fetched_after=started)
            finally:
                with self._factory() as session:
                    assign_dedup_groups(session)
                    session.commit()
                pop_warnings = getattr(connector, "pop_warnings", None)
                if pop_warnings is not None:
                    result.warnings.extend(pop_warnings())
            return
        since = self._since(last, act_progress, self._overlap)
        wellness_since = self._since(last, well_progress, self._overlap)
        if (
            since_floor is not None
        ):  # repli : au plus tôt le début de l'indisponibilité de la principale
            since = max(since, since_floor) if since else since_floor
            wellness_since = max(wellness_since, since_floor) if wellness_since else since_floor

        try:
            self._ingest(name, RAW_ACTIVITY, connector.fetch_activities(since), result)
            self._ingest(
                name,
                RAW_WELLNESS,
                connector.fetch_wellness(wellness_since.date() if wellness_since else None),
                result,
            )
            fetch_calendar = getattr(connector, "fetch_calendar", None)
            if fetch_calendar is not None:
                self._ingest(
                    name,
                    RAW_CALENDAR,
                    fetch_calendar(wellness_since.date() if wellness_since else None),
                    result,
                )
            fetch_profile = getattr(connector, "fetch_profile", None)
            if fetch_profile is not None:
                rec = fetch_profile()
                self._ingest(name, RAW_PROFILE, [rec] if rec else [], result)
            self._sync_streams(name, connector, result)
        finally:
            with self._factory() as session:
                assign_dedup_groups(session)
                session.commit()
            pop_warnings = getattr(connector, "pop_warnings", None)
            if pop_warnings is not None:
                result.warnings.extend(pop_warnings())

    def _ingest(
        self, name: str, raw_type: str, records: Iterable[RawRecord], result: SourceResult
    ) -> None:
        """Écrit les bruts par lots (un échec en cours de route conserve les lots déjà reçus)."""
        for batch in batched(records, BATCH_SIZE):
            result.fetched += len(batch)
            with self._factory() as session:
                touched = [
                    row
                    for rec in batch
                    if (row := self._upsert_raw(session, name, raw_type, rec, result)) is not None
                ]
                session.flush()
                for row in touched:
                    normalize_raw(session, row, self.normalizers)
                session.commit()

    def _sync_streams(
        self,
        name: str,
        connector: SourceConnector,
        result: SourceResult,
        fetched_after: datetime | None = None,
    ) -> None:
        """Récupère les flux des activités qui n'en ont pas encore (reprise après échec incluse).

        Avec `fetched_after`, seulement celles reçues depuis cet instant (vérification rapide).
        """
        with self._factory() as session:
            have = select(RawPayload.external_key).where(
                RawPayload.source == name, RawPayload.type == RAW_STREAM
            )
            missing = list(
                session.scalars(
                    select(RawPayload.external_key)
                    .where(
                        RawPayload.source == name,
                        RawPayload.type == RAW_ACTIVITY,
                        RawPayload.external_key.not_in(have),
                        *([RawPayload.fetched_at >= fetched_after] if fetched_after else []),
                    )
                    .order_by(RawPayload.id)
                )
            )
        failures = 0
        for ext_id in missing:
            try:
                rec = connector.fetch_activity_stream(ext_id)
                # None = la source n'a pas de flux : marqueur vide pour ne pas réessayer.
                rec = rec or RawRecord(ext_id, {})
                with self._factory() as session:
                    row = self._upsert_raw(session, name, RAW_STREAM, rec, SourceResult(name))
                    session.flush()
                    if row is not None:
                        normalize_raw(session, row, self.normalizers)
                    session.commit()
                result.streams += 1
                failures = 0
            except SourceError as exc:
                if exc.state == STATE_AUTH_REQUIRED:
                    raise
                failures += 1
                self._warn_stream(name, ext_id, exc.user_message, result)
            except Exception as exc:  # un flux manquant ne fait pas échouer la source
                failures += 1
                self._warn_stream(name, ext_id, f"{type(exc).__name__}: {exc}", result)
            if failures >= MAX_CONSECUTIVE_STREAM_FAILURES:
                result.warnings.append("Récupération des flux interrompue après plusieurs échecs")
                break

    def _warn_stream(self, name: str, ext_id: str, detail: str, result: SourceResult) -> None:
        msg = self._masker.mask(f"flux {ext_id} : {detail}")[:300]
        result.warnings.append(msg)
        logger.warning("Source %s : %s", name, msg)

    @staticmethod
    def _upsert_raw(
        session: Session, source: str, raw_type: str, rec: RawRecord, result: SourceResult
    ) -> RawPayload | None:
        """Upsert idempotent ; renvoie la ligne si nouvelle ou modifiée, sinon None."""
        digest = payload_hash(rec.payload)
        row = session.scalars(
            select(RawPayload).where(
                RawPayload.source == source,
                RawPayload.type == raw_type,
                RawPayload.external_key == rec.key,
            )
        ).first()
        if row is None:
            row = RawPayload(
                source=source,
                type=raw_type,
                external_key=rec.key,
                fetched_at=utcnow(),
                payload=rec.payload,
                hash=digest,
            )
            session.add(row)
            result.inserted += 1
            return row
        if row.hash == digest:
            result.unchanged += 1
            return None
        row.payload = rec.payload
        row.hash = digest
        row.fetched_at = utcnow()
        result.updated += 1
        return row

    # statut ----------------------------------------------------------------------------------

    def _record_success(self, name: str, warnings: Sequence[str]) -> None:
        with self._factory() as session:
            st = session.get(SourceStatus, name) or SourceStatus(source=name)
            session.add(st)
            st.last_success_at = utcnow()
            st.unavailable_since = None
            if warnings:
                st.state = STATE_DEGRADED
                st.message = f"Synchronisation partielle : {warnings[0]}"[:500]
            else:
                st.state = STATE_OK
                st.message = "Synchronisation à jour"
            session.commit()

    def _record_failure(self, name: str, state: str, message: str) -> None:
        with self._factory() as session:
            st = session.get(SourceStatus, name) or SourceStatus(source=name)
            session.add(st)
            now = utcnow()
            st.last_error_at = now
            st.last_error_message = message
            st.state = state
            st.message = message
            if st.unavailable_since is None:
                st.unavailable_since = now
            session.commit()
