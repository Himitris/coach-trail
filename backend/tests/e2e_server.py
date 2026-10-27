"""Serveur de recette de bout en bout : vrai backend + FakeConnector + frontend construit.

    python -m tests.e2e_server --port 8765 --static ../frontend/dist --data /tmp/coach-e2e

Base vide au démarrage ; la synchronisation (bouton ou API) charge les données de fixture, toutes
relatives à la date du jour pour que « semaine en cours », « dernières sorties » et « saisie du
soir » aient toujours de quoi s'afficher. Réservé aux tests : jamais déployé.
"""

import argparse
import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from app.config import Settings
from app.main import create_app
from app.sync.service import SyncService
from tests.fake_connector import FAKE_NORMALIZER, FakeConnector, activity_payload, wellness_payload

# (jours avant aujourd'hui, minutes, km, D+) : une sortie aujourd'hui, six jours de course/semaine
OUTINGS = [
    (0, 62, 11.0, 420),
    (1, 45, 8.0, 120),
    (2, 75, 12.5, 650),
    (4, 50, 9.0, 200),
    (9, 240, 32.0, 1400),  # sortie longue : nutrition à saisir
]
HISTORY = [(d, 55, 9.0, 300) for d in range(6, 40, 2)]


def fixture_connector(now: datetime) -> FakeConnector:
    activities: list[dict[str, Any]] = []
    streams: dict[str, dict[str, Any]] = {}
    for n, (days_ago, minutes, km, gain) in enumerate(OUTINGS + HISTORY):
        start = (now - timedelta(days=days_ago)).replace(hour=5, minute=0, second=0, microsecond=0)
        ext = f"e2e-{n}"
        activities.append(
            activity_payload(
                ext,
                start=start.isoformat(),
                duration=minutes * 60,
                distance=km * 1000,
                gain=gain,
                loss=gain,
                hr_avg=140 + n % 8,
                hr_max=172,
            )
        )
        points = minutes * 60
        streams[ext] = {
            "t": list(range(points)),
            "fc": [128 + (i // 120) % 30 for i in range(points)],
            "alt": [300.0 + gain * (i / points) for i in range(points)],
        }
    wellness = [
        wellness_payload((now - timedelta(days=n)).date().isoformat(), 62.0 + (n % 5))
        for n in range(70)
    ]
    return FakeConnector("garmin", activities=activities, wellness=wellness, streams=streams)


def build_app(data_dir: Path, static_dir: Path) -> FastAPI:
    settings = Settings(
        database_path=str(data_dir / "coach.db"),
        backup_dir=str(data_dir / "backup"),
        garmin_token_dir=str(data_dir / "tokens"),
        scheduler_enabled=False,
    )
    app = create_app(settings)
    app.state.sync_service = SyncService(
        app.state.session_factory,
        {"garmin": fixture_connector(datetime.now(UTC))},
        {"garmin": FAKE_NORMALIZER},
    )
    index = static_dir / "index.html"
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> Response:  # routes /p/…, /sources : la SPA gère le routage
        return FileResponse(index)

    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--static", type=Path, required=True)
    parser.add_argument("--data", type=Path, required=True)
    args = parser.parse_args()
    shutil.rmtree(args.data, ignore_errors=True)
    args.data.mkdir(parents=True)
    uvicorn.run(
        build_app(args.data, args.static), host="127.0.0.1", port=args.port, log_level="warning"
    )


if __name__ == "__main__":
    main()
