import json
import sqlite3
import subprocess
from collections.abc import Iterator
from contextlib import closing
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import cli
from app.backup import (
    DAILY_KEEP,
    MONTHLY_KEEP,
    WEEKLY_KEEP,
    BackupError,
    BackupService,
    integrity_check,
    restore_backup,
)
from app.config import Settings, get_settings
from app.main import create_app
from app.models import Goal
from app.sync.scheduler import BACKUP_JOB_ID

DEPLOY = Path(__file__).resolve().parents[2] / "deploy"


class Env:
    def __init__(self, client: TestClient, db: Path, backup: Path) -> None:
        self.client = client
        self.db = db
        self.backup = backup
        self.service = BackupService(db, backup, "Europe/Paris")

    def goal_names(self, path: Path | None = None) -> list[str]:
        with closing(sqlite3.connect(path or self.db)) as conn:
            return sorted(r[0] for r in conn.execute("SELECT nom FROM goal"))


@pytest.fixture
def env(tmp_path: Path) -> Iterator[Env]:
    db, backup = tmp_path / "data" / "coach.db", tmp_path / "backup"
    settings = Settings(database_path=str(db), backup_dir=str(backup), scheduler_enabled=False)
    with TestClient(create_app(settings)) as client:
        factory = client.app.state.session_factory  # type: ignore[attr-defined]
        with factory() as s:
            s.add(Goal(nom="Course test", date=date(2027, 1, 1), priorite=1))
            s.commit()
        yield Env(client, db, backup)


def test_backup_is_a_verified_standalone_copy(env: Env) -> None:
    status = env.service.run(date(2026, 10, 15))
    assert status.ok is True and status.integrity == "ok"
    copy = env.backup / "daily" / "coach-2026-10-15.db"
    assert status.file == copy.name and status.size_bytes == copy.stat().st_size
    assert integrity_check(copy) == "ok"
    assert "Course test" in env.goal_names(copy)
    with closing(sqlite3.connect(copy)) as conn:  # autonome : pas de WAL à rejouer
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    assert not list(env.backup.rglob("*.tmp"))
    assert (env.backup / "weekly" / "coach-2026-W42.db").exists()
    assert (env.backup / "monthly" / "coach-2026-10.db").exists()


def test_backup_while_the_app_keeps_writing(env: Env) -> None:
    factory = env.client.app.state.session_factory  # type: ignore[attr-defined]
    with factory() as s:
        s.add(Goal(nom="Écrit pendant", date=date(2027, 2, 1), priorite=2))
        s.commit()  # reste éventuellement dans le WAL : la copie doit le contenir
    assert env.service.run(date(2026, 10, 15)).ok is True
    copy = env.backup / "daily" / "coach-2026-10-15.db"
    assert "Écrit pendant" in env.goal_names(copy)


def test_rotation_keeps_7_daily_4_weekly_6_monthly(env: Env) -> None:
    first = date(2026, 1, 1)
    for n in range(200):
        assert env.service.run(first + timedelta(days=n)).ok is True
    daily = sorted(p.name for p in (env.backup / "daily").iterdir())
    weekly = sorted(p.name for p in (env.backup / "weekly").iterdir())
    monthly = sorted(p.name for p in (env.backup / "monthly").iterdir())
    last = first + timedelta(days=199)  # 2026-07-19
    assert len(daily) == DAILY_KEEP and daily[-1] == f"coach-{last}.db"
    assert daily[0] == f"coach-{last - timedelta(days=6)}.db"
    assert len(weekly) == WEEKLY_KEEP and weekly[-1].startswith("coach-2026-W29")
    assert len(monthly) == MONTHLY_KEEP
    assert monthly == [f"coach-2026-{m:02d}.db" for m in range(2, 8)]
    status = env.service.status()
    assert (status.daily, status.weekly, status.monthly) == (7, 4, 6)
    assert status.total_size_bytes > 0


def test_same_day_rerun_replaces_instead_of_duplicating(env: Env) -> None:
    env.service.run(date(2026, 10, 15))
    env.service.run(date(2026, 10, 15))
    assert len(list((env.backup / "daily").iterdir())) == 1


def test_corrupt_source_fails_without_touching_good_backups(env: Env) -> None:
    env.service.run(date(2026, 10, 14))
    good = (env.backup / "daily" / "coach-2026-10-14.db").read_bytes()
    env.client.__exit__(None, None, None)  # ferme l'app, puis abîme le fichier
    for suffix in ("-wal", "-shm"):
        Path(str(env.db) + suffix).unlink(missing_ok=True)
    env.db.write_bytes(b"ceci n'est pas une base sqlite" * 200)
    status = env.service.run(date(2026, 10, 15))
    assert status.ok is False and "Échec" in status.message
    assert status.stale is True
    assert (env.backup / "daily" / "coach-2026-10-14.db").read_bytes() == good
    assert not (env.backup / "daily" / "coach-2026-10-15.db").exists()
    assert not list(env.backup.rglob("*.tmp"))


def test_missing_database_and_unwritable_dir_never_raise(tmp_path: Path) -> None:
    missing = BackupService(tmp_path / "absent.db", tmp_path / "b").run()
    assert missing.ok is False and "introuvable" in missing.message
    blocker = tmp_path / "file"
    blocker.write_text("x")
    db = tmp_path / "x.db"
    with closing(sqlite3.connect(db)) as conn:
        conn.execute("CREATE TABLE alembic_version (v TEXT)")
    status = BackupService(db, blocker / "sub").run()
    assert status.ok is None and status.last_run_at is None  # rien n'a pu être écrit


def test_status_before_any_backup_and_staleness(env: Env) -> None:
    fresh = env.service.status()
    assert fresh.ok is None and fresh.stale is True and fresh.last_run_at is None
    env.service.run(date(2026, 10, 15))
    assert env.service.status().stale is False
    old = (datetime.now(UTC).replace(tzinfo=None) - timedelta(hours=40)).isoformat()
    stored = json.loads(env.service.status_path.read_text())
    stored["last_run_at"] = old
    env.service.status_path.write_text(json.dumps(stored))
    assert env.service.status().stale is True


def test_status_endpoint_reads_state_without_running(env: Env) -> None:
    body = env.client.get("/api/backup/status").json()
    assert body["ok"] is None and body["daily"] == 0
    env.service.run(date(2026, 10, 15))
    body = env.client.get("/api/backup/status").json()
    assert body["ok"] is True and body["daily"] == 1 and body["integrity"] == "ok"
    assert body["backup_dir"] == str(env.backup)


def test_integrity_check_rejects_foreign_and_empty_files(tmp_path: Path) -> None:
    empty = tmp_path / "empty.db"
    with closing(sqlite3.connect(empty)) as conn:
        conn.execute("CREATE TABLE t (a)")
    assert "non migrée" in integrity_check(empty)
    junk = tmp_path / "junk.db"
    junk.write_bytes(b"junk" * 500)
    assert integrity_check(junk) != "ok"


# --- restauration ---------------------------------------------------------------------------


def test_restore_replaces_the_database_and_keeps_a_safety_copy(env: Env) -> None:
    env.service.run(date(2026, 10, 15))
    backup = env.backup / "daily" / "coach-2026-10-15.db"
    expected = env.goal_names()
    env.client.__exit__(None, None, None)  # API arrêtée
    with closing(sqlite3.connect(env.db)) as conn:
        conn.execute("DELETE FROM goal")
        conn.commit()
    assert env.goal_names() == []
    safety = restore_backup(backup, env.db)
    assert env.goal_names() == expected
    assert integrity_check(env.db) == "ok"
    assert safety.exists() and "avant-restauration" in safety.name
    assert env.goal_names(safety) == []  # l'ancien état est conservé
    assert not Path(str(env.db) + "-wal").exists()


def test_restore_refuses_a_bad_backup_and_leaves_the_database_alone(
    env: Env, tmp_path: Path
) -> None:
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"not a database" * 300)
    before = env.goal_names()
    with pytest.raises(BackupError, match="inutilisable"):
        restore_backup(bad, env.db)
    assert env.goal_names() == before
    assert not list(env.db.parent.glob("*avant-restauration*"))


def test_restore_into_a_temporary_copy_end_to_end(env: Env, tmp_path: Path) -> None:
    """Test de restauration sur copie temporaire : sauvegarde -> restauration -> l'app démarre."""
    env.service.run(date(2026, 10, 15))
    backup = env.backup / "daily" / "coach-2026-10-15.db"
    restored = tmp_path / "restore-test" / "coach.db"
    restore_backup(backup, restored)
    settings = Settings(database_path=str(restored), scheduler_enabled=False)
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/health").json()["db"] == "ok"
        names = [g["nom"] for g in client.get("/api/goals").json()]
        assert "Course test" in names and "Trail des 3 Rocs" in names


def test_cli_backup_and_restore(
    env: Env, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_PATH", str(env.db))
    monkeypatch.setenv("BACKUP_DIR", str(env.backup))
    get_settings.cache_clear()
    try:
        assert cli.main(["backup"]) == 0
        files = list((env.backup / "daily").iterdir())
        assert len(files) == 1
        env.client.__exit__(None, None, None)
        assert cli.main(["restore", str(files[0])]) == 0
        assert "Base restaurée" in capsys.readouterr().out
        assert cli.main(["restore", str(env.backup / "nope.db")]) == 1
    finally:
        get_settings.cache_clear()


def test_scheduler_registers_the_daily_backup(tmp_path: Path) -> None:
    settings = Settings(
        database_path=str(tmp_path / "s.db"), backup_dir=str(tmp_path / "b"), backup_time="04:30"
    )
    with TestClient(create_app(settings)) as client:
        job = client.app.state.scheduler.get_job(BACKUP_JOB_ID)  # type: ignore[attr-defined]
        assert (
            job is not None and "hour='4'" in str(job.trigger) and "minute='30'" in str(job.trigger)
        )


def test_backup_time_must_be_hh_mm() -> None:
    with pytest.raises(ValueError, match="HH:MM"):
        Settings(backup_time="4h30")


def test_restore_script_is_valid_bash() -> None:
    script = DEPLOY / "restore.sh"
    assert script.exists()
    subprocess.run(["bash", "-n", str(script)], check=True)  # noqa: S603, S607
