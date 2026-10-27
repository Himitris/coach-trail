import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from app.backup import BackupService
from app.config import Settings
from app.sync.service import SyncBusyError, SyncService

logger = logging.getLogger(__name__)
NIGHTLY_JOB_ID = "nightly-sync"
BACKUP_JOB_ID = "daily-backup"


def _nightly(service: SyncService) -> None:
    try:
        service.run_all("nightly")
    except SyncBusyError:
        logger.info("Sync nocturne ignorée : une synchronisation est déjà en cours")


def build_scheduler(
    service: SyncService, settings: Settings, backup: BackupService | None = None
) -> BackgroundScheduler:
    hour, minute = settings.sync_hour_minute
    scheduler = BackgroundScheduler(timezone=settings.tz)
    scheduler.add_job(
        _nightly,
        CronTrigger(hour=hour, minute=minute, timezone=settings.tz),
        args=[service],
        id=NIGHTLY_JOB_ID,
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600,
    )
    if backup is not None:
        b_hour, b_minute = settings.backup_hour_minute
        scheduler.add_job(
            backup.run,
            CronTrigger(hour=b_hour, minute=b_minute, timezone=settings.tz),
            id=BACKUP_JOB_ID,
            coalesce=True,
            max_instances=1,
            misfire_grace_time=3600,
        )
    return scheduler
