# Coach Trail

Application web personnelle (1 utilisateur) de suivi d'entraînement trail, hébergée sur Proxmox, accessible uniquement via Tailscale sur `coach.himitris.fr`.

- Cahier des charges : `docs/Cahier des charges – Coach Trail.docx` (résumé dans `CLAUDE.md`)
- Prompts de construction, à exécuter dans l'ordre : `prompts/` (voir `prompts/00-INDEX.md`)

## Stack
Python 3.12 + FastAPI · SQLite · React + Vite + react-grid-layout · Caddy (DNS-01 OVH) · Docker Compose

## Structure
```
backend/   API FastAPI, synchronisation, calcul des métriques
frontend/  Interface React
deploy/    docker-compose, Caddy, contrôle (check.sh) et restauration (restore.sh)
docs/      Cahier des charges, checklist de recette (recette-phase1.md)
prompts/   Prompts de génération par phase
data/      Base SQLite et JSON bruts (non versionné)
```

## Sources et repli

Garmin Connect est la source principale. **Intervals.icu** (clé personnelle : `INTERVALS_ATHLETE_ID` et `INTERVALS_API_KEY` dans `deploy/.env`) sert de repli silencieux : appelé seulement si Garmin est indisponible, avec le badge « Garmin indisponible depuis le … » et les dernières valeurs conservées. Training Readiness et Body Battery restent vides pendant un repli (« non disponible via Intervals.icu »). Détails : `backend/README.md`.

## Installation

Détail pas à pas (Proxmox, Tailscale, clés OVH, DNS) : [`deploy/README.md`](deploy/README.md). En bref, sur l'hôte :

```bash
git clone <dépôt> coach-trail && cd coach-trail
cp .env.example deploy/.env && chmod 600 deploy/.env && nano deploy/.env   # DOMAIN, TAILSCALE_IP, OVH_*, BACKUP_HOST_DIR…
mkdir -p data && chown 1000:1000 data                                       # l'API tourne en uid 1000
sudo mkdir -p "$BACKUP_HOST_DIR" && sudo chown 1000:1000 "$BACKUP_HOST_DIR" # disque distinct de data/
cd deploy && docker compose up -d --build && ./check.sh
docker compose exec api python -m app.cli garmin-login                     # première connexion Garmin (MFA)
```

Les migrations de la base s'appliquent toutes seules au démarrage. Puis dérouler [`docs/recette-phase1.md`](docs/recette-phase1.md).

## Mise à jour

```bash
cd coach-trail && git pull
cd deploy && docker compose up -d --build   # reconstruit les images, migre la base, redémarre
./check.sh
```

Faire une sauvegarde juste avant (`docker compose exec api python -m app.cli backup`). Surveiller en particulier la version de `garminconnect` (épinglée dans `backend/pyproject.toml`) : c'est la brique la plus exposée aux changements de Garmin.

## Sauvegarde et restauration

- **Quoi** : la base SQLite `data/coach.db`, qui contient les JSON bruts (`raw_payload`) *et* les tables normalisées. Les jetons Garmin ne sont volontairement pas sauvegardés (secrets) : en cas de perte, se reconnecter.
- **Quand / où** : chaque nuit à `BACKUP_TIME` (04:30, après la synchronisation de 03:30), vers `BACKUP_HOST_DIR` (monté en `/backup`), qui doit être un **disque physiquement distinct** de `data/`.
- **Comment** : API de copie de SQLite (jamais une copie brute du fichier en cours d'écriture), puis `PRAGMA integrity_check` sur la copie ; une copie qui échoue au contrôle n'est pas conservée et n'écrase rien.
- **Rotation** : 7 quotidiennes (`daily/`), 4 hebdomadaires (`weekly/`), 6 mensuelles (`monthly/`).
- **Suivi** : carte « Sauvegardes » de la page *Santé des sources* (dernière sauvegarde, taille, intégrité, copies conservées, avertissement si le volume est le même que la base). Sauvegarde immédiate : `docker compose exec api python -m app.cli backup`.

Restaurer (arrête l'API quelques secondes, garde l'ancienne base à côté en `coach.db.avant-restauration-…`) :

```bash
cd deploy
./restore.sh                              # liste les sauvegardes
./restore.sh daily/coach-2026-10-15.db    # restaure, redémarre l'API, vérifie /api/health
```

Le test de restauration sur copie temporaire est automatisé (`backend/tests/test_backup.py`) ; le faire aussi une fois sur le serveur avant la mise en service (voir la recette).

## Développement et tests

```bash
cd backend && pip install -e '.[dev]' && ruff check . && mypy && pytest
cd frontend && npm ci && npm run lint && npm run typecheck && npm test
cd frontend && npm run e2e      # bout en bout : vrai backend + FakeConnector + frontend construit
```
