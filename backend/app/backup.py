"""Sauvegarde quotidienne de la base SQLite, rotation et restauration.

La base contient les deux couches (JSON bruts dans `raw_payload`, tables normalisées) : une seule
copie cohérente suffit. La copie passe par l'API `backup` de SQLite (jamais une copie brute du
fichier, qui peut être en cours d'écriture), puis `PRAGMA integrity_check` est exécuté sur la copie
avant toute rotation : une sauvegarde douteuse ne remplace ni n'évince jamais une bonne.

Rotation : 7 quotidiennes (`daily/coach-AAAA-MM-JJ.db`), 4 hebdomadaires
(`weekly/coach-AAAA-Wss.db`, la première copie vérifiée de chaque semaine ISO) et 6 mensuelles
(`monthly/coach-AAAA-MM.db`).
"""

import contextlib
import json
import os
import shutil
import sqlite3
import time
from contextlib import closing
from datetime import UTC, date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from pydantic import BaseModel

DAILY_KEEP = 7
WEEKLY_KEEP = 4
MONTHLY_KEEP = 6
STATUS_FILE = "status.json"
STALE_AFTER_H = 36
REQUIRED_TABLE = "alembic_version"  # une base migrée : écarte un fichier vide ou étranger


class BackupError(Exception):
    pass


class BackupStatus(BaseModel):
    backup_dir: str
    last_run_at: datetime | None
    ok: bool | None  # None : aucune sauvegarde tentée
    message: str
    file: str | None
    size_bytes: int | None
    integrity: str | None
    daily: int
    weekly: int
    monthly: int
    total_size_bytes: int
    stale: bool
    warning: str | None


def _now_utc() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def integrity_check(path: Path) -> str:
    """« ok » si la base est saine et migrée, sinon la raison. Lecture seule."""
    try:
        with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as conn:
            rows = [r[0] for r in conn.execute("PRAGMA integrity_check")]
            if rows != ["ok"]:
                return "; ".join(str(r) for r in rows[:3])
            has_table = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (REQUIRED_TABLE,)
            ).fetchone()
            return "ok" if has_table else f"table {REQUIRED_TABLE} absente (base non migrée)"
    except sqlite3.DatabaseError as exc:
        return f"illisible : {exc}"


def snapshot(src: Path, dest: Path) -> None:
    """Copie cohérente de `src` vers `dest` (fichier autonome, sans WAL) via l'API SQLite."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".tmp")
    tmp.unlink(missing_ok=True)
    try:
        with closing(sqlite3.connect(src)) as source, closing(sqlite3.connect(tmp)) as target:
            source.backup(target)
            target.execute("PRAGMA journal_mode=DELETE")
        verdict = integrity_check(tmp)
        if verdict != "ok":
            raise BackupError(f"contrôle d'intégrité échoué : {verdict}")
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)


def _prune(folder: Path, keep: int) -> None:
    files = sorted(p for p in folder.glob("coach-*.db") if p.is_file())
    for old in files[:-keep] if keep else files:
        old.unlink(missing_ok=True)


def _size(paths: list[Path]) -> int:
    return sum(p.stat().st_size for p in paths if p.is_file())


class BackupService:
    def __init__(self, db_path: Path, backup_dir: Path, tz: str = "Europe/Paris") -> None:
        self.db_path = db_path
        self.backup_dir = backup_dir
        self.tz = ZoneInfo(tz)

    @property
    def status_path(self) -> Path:
        return self.backup_dir / STATUS_FILE

    def _local_day(self) -> date:
        return datetime.now(self.tz).date()

    def _write_status(self, **fields: object) -> None:
        payload = {"last_run_at": _now_utc().isoformat(), **fields}
        tmp = self.status_path.with_name(STATUS_FILE + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.status_path)

    def run(self, day: date | None = None) -> BackupStatus:
        """Sauvegarde, vérifie, tourne. N'élève jamais : le résultat est dans le statut."""
        day = day or self._local_day()
        started = time.monotonic()
        try:
            self.backup_dir.mkdir(parents=True, exist_ok=True)
            if not self.db_path.is_file():
                raise BackupError(f"base introuvable : {self.db_path}")
            target = self.backup_dir / "daily" / f"coach-{day.isoformat()}.db"
            snapshot(self.db_path, target)
            iso = day.isocalendar()
            weekly = self.backup_dir / "weekly" / f"coach-{iso.year}-W{iso.week:02d}.db"
            monthly = self.backup_dir / "monthly" / f"coach-{day:%Y-%m}.db"
            for copy in (weekly, monthly):
                if not copy.exists():
                    copy.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(target, copy)
            for folder, keep in (
                ("daily", DAILY_KEEP),
                ("weekly", WEEKLY_KEEP),
                ("monthly", MONTHLY_KEEP),
            ):
                _prune(self.backup_dir / folder, keep)
            self._write_status(
                ok=True,
                message=f"Sauvegarde réussie en {time.monotonic() - started:.1f} s.",
                file=target.name,
                size_bytes=target.stat().st_size,
                integrity="ok",
            )
        except (BackupError, OSError, sqlite3.Error) as exc:
            with contextlib.suppress(OSError):  # dossier inaccessible : le statut reste en mémoire
                self._write_status(
                    ok=False,
                    message=f"Échec : {type(exc).__name__}: {exc}",
                    file=None,
                    size_bytes=None,
                    integrity=None,
                )
        return self.status()

    def _stored(self) -> dict[str, object]:
        try:
            data = json.loads(self.status_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def status(self) -> BackupStatus:
        stored = self._stored()
        folders = {
            n: sorted((self.backup_dir / n).glob("coach-*.db"))
            for n in ("daily", "weekly", "monthly")
        }
        last = stored.get("last_run_at")
        last_run = datetime.fromisoformat(str(last)) if last else None
        ok = stored.get("ok")
        stale = (
            last_run is None
            or ok is not True
            or (_now_utc() - last_run).total_seconds() > STALE_AFTER_H * 3600
        )
        warning = None
        with contextlib.suppress(OSError):
            if (
                self.backup_dir.exists()
                and os.stat(self.db_path.parent).st_dev == os.stat(self.backup_dir).st_dev
            ):
                warning = (
                    "La sauvegarde est sur le même volume que la base : elle ne protège pas "
                    "d'une perte du disque. Monter BACKUP_DIR sur un disque distinct."
                )
        return BackupStatus(
            backup_dir=str(self.backup_dir),
            last_run_at=last_run,
            ok=ok if isinstance(ok, bool) else None,
            message=str(stored.get("message") or "Aucune sauvegarde effectuée."),
            file=str(stored["file"]) if stored.get("file") else None,
            size_bytes=int(str(stored["size_bytes"]))
            if stored.get("size_bytes") is not None
            else None,
            integrity=str(stored["integrity"]) if stored.get("integrity") else None,
            daily=len(folders["daily"]),
            weekly=len(folders["weekly"]),
            monthly=len(folders["monthly"]),
            total_size_bytes=_size([p for files in folders.values() for p in files]),
            stale=stale,
            warning=warning,
        )


def restore_backup(backup_file: Path, db_path: Path) -> Path:
    """Remplace la base par une sauvegarde vérifiée ; l'API doit être arrêtée.

    L'ancienne base (et ses fichiers WAL) est conservée à côté, suffixée `.avant-restauration-…`.
    Retourne le chemin de cette copie de sécurité (ou celui de la base si elle n'existait pas).
    """
    verdict = integrity_check(backup_file)
    if verdict != "ok":
        raise BackupError(f"sauvegarde inutilisable ({backup_file.name}) : {verdict}")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    stamp = _now_utc().strftime("%Y%m%d-%H%M%S")
    safety = db_path.with_name(f"{db_path.name}.avant-restauration-{stamp}")
    for suffix in ("", "-wal", "-shm"):
        current = db_path.with_name(db_path.name + suffix)
        if current.exists():
            os.replace(current, safety.with_name(safety.name + suffix))
    tmp = db_path.with_name(db_path.name + ".restauration.tmp")
    try:
        shutil.copyfile(backup_file, tmp)
        os.replace(tmp, db_path)
    finally:
        tmp.unlink(missing_ok=True)
    verdict = integrity_check(db_path)
    if verdict != "ok":
        raise BackupError(f"base restaurée invalide : {verdict}")
    return safety
