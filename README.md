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
deploy/    docker-compose, Caddy, scripts de sauvegarde
docs/      Cahier des charges
prompts/   Prompts de génération par phase
data/      Base SQLite et JSON bruts (non versionné)
```
