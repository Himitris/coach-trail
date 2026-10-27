# Backend — Coach Trail

FastAPI + SQLite (WAL) + Alembic. Les migrations s'appliquent au démarrage.

```bash
python -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/ruff check . && .venv/bin/mypy && .venv/bin/pytest
```

## Garmin Connect

Source principale, via la bibliothèque **non officielle** `python-garminconnect` (version épinglée
dans `pyproject.toml`). Elle peut casser sans préavis : jetons de session, MFA, protections
anti-robot.

### Première connexion (ou reconnexion)

```bash
# dans le conteneur api, ou en local avec GARMIN_TOKEN_DIR défini
python -m app.cli garmin-login
```

Le script demande email, mot de passe (non affiché) et code MFA, enregistre les jetons dans
`GARMIN_TOKEN_DIR/garmin_tokens.json` (droits 600, dossier 700) et **ne conserve jamais le mot de
passe**. Équivalent pour l'écran de reconnexion : `POST /api/garmin/login`

1. `{"email": "...", "password": "..."}` → `{"status": "ok"}` ou `{"status": "mfa_required", "ticket": "..."}`
2. `{"ticket": "...", "mfa_code": "123456"}` → `{"status": "ok"}`

Le ticket vit 10 minutes en mémoire, est à usage unique, et les tentatives sont limitées
(5 par 10 minutes) pour ne pas verrouiller le compte Garmin.

### États de la source (`GET /api/sources/health`)

| état | signification |
|------|---------------|
| `ok` | dernière synchronisation complète |
| `degraded` | synchronisation terminée mais certains appels ont échoué (détail dans `message`) |
| `auth_required` | jetons absents/expirés, ou 401/403/429 (anti-robot) : reconnexion nécessaire |
| `down` | Garmin injoignable ou en erreur ; les dernières données sont conservées |

En cas d'échec, les données déjà stockées ne sont jamais supprimées et l'API reste disponible.
Un échec partiel conserve les lots déjà reçus et la synchronisation suivante reprend après eux.

### Ce qui est récupéré

- Activités : liste + détail (brut), puis flux seconde par seconde (FC, altitude, vitesse,
  distance, cadence). Le brut du flux ne garde que ces canaux, sans tracé GPS.
- Par jour : résumé (FC repos, stress, Body Battery), sommeil, HRV nocturne + plage de référence,
  Training Readiness, poids. Statut d'entraînement et prédictions de course pour le jour courant
  (conservés dans le brut, non normalisés pour l'instant).
- Profil : zones FC et seuil lactique → `athlete_profile` (FC repos, seuil, zones). La FC max
  n'est jamais modifiée par la synchronisation.
- Historique initial : `GARMIN_HISTORY_MONTHS` (défaut 12), puis incrémental (recouvrement 3 jours).
  Le premier passage fait ~4 appels par jour avec une pause aléatoire de 1 à 3 s entre appels
  (`GARMIN_MIN_DELAY_S`, `GARMIN_MAX_DELAY_S`) : prévoir environ une heure pour 12 mois.
- L'« efficacité du sommeil » est une estimation (temps endormi / fenêtre de sommeil) : Garmin ne la
  fournit pas.

## Capturer de nouvelles fixtures Garmin

Les fixtures de `tests/fixtures/garmin/` sont **synthétiques** (écrites d'après la structure
documentée de la bibliothèque). Pour les remplacer par des réponses réelles :

```python
# script jetable, hors dépôt
import json
from garminconnect import Garmin

api = Garmin()
api.login(tokenstore="/data/garmin_tokens")
day = "2026-10-04"
captures = {
    "sleep.json": api.get_sleep_data(day),
    "hrv.json": api.get_hrv_data(day),
    "user_summary.json": api.get_user_summary(day),
    "training_readiness.json": api.get_training_readiness(day),
    "heart_rate_zones.json": api.get_heart_rate_zones(),
    "lactate_threshold.json": api.get_lactate_threshold(latest=True),
}
acts = api.get_activities_by_date(day, day)
if acts:
    aid = str(acts[0]["activityId"])
    captures["activity_summary.json"] = acts[0]
    captures["activity_detail.json"] = api.get_activity(aid)
    captures["activity_details.json"] = api.get_activity_details(aid, maxchart=200, maxpoly=0)
for name, data in captures.items():
    json.dump(data, open(name, "w"), indent=2, ensure_ascii=False)
```

Avant de commiter, **anonymiser** : remplacer `userProfilePK`, `userProfileId`, `activityId`,
`deviceId`, noms d'activité, `ownerDisplayName`/`ownerFullName`, coordonnées GPS
(`startLatitude`, `startLongitude`, `locationName`), dates ramenées à 2026-10-04 si besoin, et
vérifier avec `grep -rniE 'mail|@|token|latitude|longitude' tests/fixtures/garmin`. Réduire
`activityDetailMetrics` à quelques échantillons. Aucun test ne doit appeler le réseau.
