"""Commandes d'administration : `python -m app.cli garmin-login | seed-demo`."""

import argparse
import getpass
import sys
from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.config import get_settings
from app.db import make_engine, make_session_factory
from app.garmin.auth import login_interactive
from app.logging import configure_logging
from app.main import run_migrations
from app.plan.seed import seed_demo_week


def garmin_login() -> int:
    settings = get_settings()
    configure_logging(settings.secret_values())
    email = input("Email Garmin : ").strip()
    password = getpass.getpass("Mot de passe Garmin (non conservé) : ")
    try:
        login_interactive(
            settings.garmin_token_dir,
            email,
            password,
            prompt_mfa=lambda: input("Code MFA Garmin : ").strip(),
        )
    except Exception as exc:
        print(f"Échec de la connexion : {type(exc).__name__}", file=sys.stderr)
        return 1
    finally:
        del password
    print(f"Connexion réussie. Jetons enregistrés dans {settings.garmin_token_dir} (droits 600).")
    return 0


def seed_demo(week: str | None, force: bool) -> int:
    """Semaine type 80/20 pour le développement (aucune donnée envoyée à la montre)."""
    settings = get_settings()
    configure_logging(settings.secret_values())
    run_migrations(settings.database_url)
    when = date.fromisoformat(week) if week else datetime.now(ZoneInfo(settings.tz)).date()
    factory = make_session_factory(make_engine(settings.database_url))
    with factory() as session:
        added = seed_demo_week(session, when, force=force)
    if added:
        print(f"{added} séances prévues ajoutées pour la semaine du {when}.")
    else:
        print("La semaine contient déjà des séances : rien ajouté (utiliser --force).")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("garmin-login", help="connexion Garmin interactive (MFA)")
    seed = sub.add_parser("seed-demo", help="semaine type 80/20 de développement")
    seed.add_argument(
        "--week", help="une date de la semaine visée (AAAA-MM-JJ), défaut : aujourd'hui"
    )
    seed.add_argument(
        "--force", action="store_true", help="ajouter même si la semaine a des séances"
    )
    args = parser.parse_args(argv)
    if args.command == "garmin-login":
        return garmin_login()
    return seed_demo(args.week, args.force)


if __name__ == "__main__":
    sys.exit(main())
