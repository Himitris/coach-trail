import argparse
import json
import sys

from app.config import get_settings
from app.db import make_engine, make_session_factory
from app.logging import configure_logging
from app.main import run_migrations
from app.sync.registry import build_sources
from app.sync.service import SyncService, rebuild_normalized


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.sync")
    parser.add_argument("command", choices=["rebuild-normalized", "run"])
    args = parser.parse_args(argv)

    settings = get_settings()
    configure_logging(settings.secret_values())
    run_migrations(settings.database_url)
    factory = make_session_factory(make_engine(settings.database_url))
    connectors, normalizers = build_sources(settings)

    if args.command == "rebuild-normalized":
        with factory() as session:
            print(json.dumps(rebuild_normalized(session, normalizers)))
        return 0

    service = SyncService(factory, connectors, normalizers, priority=settings.priority_list)
    report = service.run_all("cli")
    print(json.dumps([r.__dict__ for r in report.results], default=str, ensure_ascii=False))
    return 0 if all(r.ok for r in report.results) else 1


if __name__ == "__main__":
    sys.exit(main())
