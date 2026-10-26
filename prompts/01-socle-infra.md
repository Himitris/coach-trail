# 01 — Socle infra (Phase 0)

Lis `CLAUDE.md`. Mets en place le socle de déploiement dans `deploy/`.

## À faire
1. `deploy/docker-compose.yml` avec les services : `caddy`, `api` (placeholder FastAPI minimal servant `GET /api/ping` → `{"ok":true}`), `web` (placeholder statique « Coach Trail — OK »). `restart: unless-stopped` partout. Volumes : `./data` → `/data`, un volume Caddy persistant.
2. `deploy/caddy/Dockerfile` : build Caddy avec le module `github.com/caddy-dns/ovh` via `xcaddy`.
3. `deploy/caddy/Caddyfile` : site `{$DOMAIN}`, TLS par défi DNS-01 OVH (clés lues dans l'environnement), `/api/*` vers `api:8000`, le reste vers `web`. Bind sur l'adresse Tailscale uniquement (`{$TAILSCALE_IP}:443` via mapping de ports Docker), jamais `0.0.0.0`. Redirection 80→443 sur la même IP.
4. Utilise `.env.example` existant comme référence ; ne lis ni ne crée de vrai `.env` avec des secrets.
5. `deploy/README.md` : procédure pas à pas en français : installer Docker et Tailscale dans le conteneur/VM Proxmox, créer les clés API OVH (droits limités à la zone), créer l'enregistrement A `coach.himitris.fr` → IP Tailscale 100.x, lancer `docker compose up -d`, vérifier. Inclure le plan B (DNS partagé Tailscale) si l'anti-rebind bloque la résolution.
6. Script `deploy/check.sh` : vérifie que `https://coach.himitris.fr/api/ping` répond et que le port 443 n'écoute pas sur l'IP publique.

## Critères d'acceptation
- `docker compose config` valide sans erreur.
- Le README permet de reproduire sans ambiguïté ; critère final documenté : page ouverte en HTTPS depuis le téléphone via Tailscale, aucune réponse hors Tailscale.
- Aucun secret versionné. Commit : `chore: socle infra (phase 0)`.
