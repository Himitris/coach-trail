"""Commandes d'administration : `python -m app.cli garmin-login`."""

import argparse
import getpass
import sys

from app.config import get_settings
from app.garmin.auth import login_interactive
from app.logging import configure_logging


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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    parser.add_argument("command", choices=["garmin-login"])
    args = parser.parse_args(argv)
    if args.command == "garmin-login":
        return garmin_login()
    return 2


if __name__ == "__main__":
    sys.exit(main())
