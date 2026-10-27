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

## Exports et import de plan

Export Markdown, JSON versionné et CSV (séries), par période, par widget et par séance ; import d'un plan JSON produit par Claude (aperçu, confirmation, jours réalisés protégés). Voir [`docs/export.md`](docs/export.md) et [`docs/prompt-plan-claude.md`](docs/prompt-plan-claude.md).

## Strava (optionnel, désactivé par défaut)

> **À lire avant d'activer** : les conditions de l'API Strava du **1er juin 2026** interdisent l'entraînement d'IA avec les données Strava. Envoyer vos propres séances à Claude pour analyse n'est pas de l'entraînement, mais lisez le texte officiel avant de connecter Strava.

Activation : créer une application sur strava.com/settings/api (domaine de retour : `coach.himitris.fr`), puis dans `deploy/.env` : `STRAVA_ENABLED=true`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, redémarrer, et cliquer sur **Connecter Strava** dans *Sources* (autorisation en lecture seule). Les jetons sont stockés en `600` dans `/data/strava_tokens`, jamais journalisés. Strava ne fournit ni HRV, ni sommeil, ni FC de repos : seules les activités et leurs flux sont importés, dédupliqués avec Garmin (priorité la plus basse). Quotas lus dans les en-têtes de réponse (200 requêtes / 15 min, 2 000 / jour) : les appels sont ralentis dès la moitié d'un quota et la synchronisation s'arrête proprement avant le blocage.

## Accès direct par Claude (MCP)

Serveur MCP en lecture seule (profil, semaine, sorties, récupération, charge, plan, export) pour Claude Desktop sur un PC du tailnet, avec jeton partagé facultatif. Voir [`docs/mcp.md`](docs/mcp.md).

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
