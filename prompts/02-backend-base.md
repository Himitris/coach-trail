# 02 — Backend de base

Lis `CLAUDE.md`. Crée le squelette backend dans `backend/` (Python 3.12, FastAPI).

## À faire
1. `pyproject.toml` (dépendances : fastapi, uvicorn, pydantic-settings, sqlalchemy 2, alembic, apscheduler, httpx, pytest, pytest-asyncio, ruff, mypy). Config ruff + mypy strict.
2. `backend/app/` : `main.py` (app factory), `config.py` (pydantic-settings lisant l'environnement, voir `.env.example`), `db.py` (SQLite en mode WAL, clés étrangères actives), `logging.py` (JSON logs avec **filtre de masquage des secrets** : tokens, clés, mots de passe).
3. Alembic configuré, migration initiale créant les tables socle :
   - `athlete_profile` (fc_max=195, fc_repos, seuil_lactique_fc, zones JSON, date de MAJ) — une seule ligne.
   - `goal` (nom, date, distance_km, dplus_m, priorité).
   - Pré-remplir les 2 objectifs : Trail des 3 Rocs (2026-11-08, 31 km, 1600 m D+) et Trail de Bruniquel (2027-02-15 provisoire, 39 km).
4. Routes : `GET /api/health` (version, état DB), `GET/PUT /api/profile`, CRUD `/api/goals`.
5. `Dockerfile` backend multi-stage, utilisateur non root, remplace le placeholder `api` de `deploy/docker-compose.yml`.
6. Tests pytest avec base SQLite temporaire : health, profil, objectifs, masquage des secrets dans les logs.

## Critères d'acceptation
`ruff`, `mypy`, `pytest` verts ; `alembic upgrade head` sur base vide fonctionne ; l'image build. Commit : `feat(backend): base FastAPI + SQLite + migrations`.
