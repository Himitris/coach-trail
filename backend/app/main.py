from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from alembic.config import Config
from fastapi import FastAPI

from alembic import command
from app import __version__
from app.config import Settings, get_settings
from app.db import make_engine, make_session_factory
from app.logging import configure_logging
from app.routes import goals, health, profile, sync
from app.sync.registry import build_sources
from app.sync.scheduler import build_scheduler
from app.sync.service import SyncService

BACKEND_DIR = Path(__file__).resolve().parent.parent


def run_migrations(database_url: str) -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(cfg, "head")


def create_app(
    settings: Settings | None = None, sync_service: SyncService | None = None
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.secret_values())
    engine = make_engine(settings.database_url)
    session_factory = make_session_factory(engine)
    if sync_service is None:
        connectors, normalizers = build_sources(settings)
        sync_service = SyncService(
            session_factory,
            connectors,
            normalizers,
            priority=settings.priority_list,
            overlap_days=settings.sync_overlap_days,
            secrets=settings.secret_values(),
        )
    scheduler = build_scheduler(sync_service, settings) if settings.scheduler_enabled else None

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        run_migrations(settings.database_url)
        if scheduler is not None:
            scheduler.start()
        yield
        if scheduler is not None:
            scheduler.shutdown(wait=False)
        engine.dispose()

    app = FastAPI(title="Coach Trail", version=__version__, lifespan=lifespan)
    app.state.settings = settings
    app.state.session_factory = session_factory
    app.state.sync_service = sync_service
    app.state.scheduler = scheduler
    for router in (health.router, profile.router, goals.router, sync.router):
        app.include_router(router, prefix="/api")
    return app


def app_factory() -> FastAPI:
    """Point d'entrée uvicorn : `uvicorn app.main:app_factory --factory`."""
    return create_app()
