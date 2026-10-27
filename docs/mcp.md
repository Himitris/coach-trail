# Claude Desktop ↔ Coach Trail (serveur MCP en lecture seule)

Le serveur MCP donne à Claude un accès **direct et en lecture seule** à vos données (profil, semaine,
sorties, récupération, charge, plan, export). Il n'écrit rien : il n'appelle que des endpoints `GET`
de l'API locale, jamais la base ni un endpoint de modification.

> **Rappel** : un connecteur distant hébergé chez Anthropic (ajout d'un « connecteur » sur claude.ai)
> **ne peut pas** joindre l'appli, puisqu'elle n'est pas exposée sur Internet (accès Tailscale
> uniquement). Le serveur se branche donc sur **Claude Desktop installé sur un PC connecté à votre
> tailnet**, qui parle à `coach.himitris.fr` en local.

## Outils

| Outil | Rôle |
|---|---|
| `get_profile` | FC max, zones, seuil, objectifs à venir avec jours restants |
| `get_week_summary(date)` | Semaine (lundi–dimanche) : temps, distance, D+, D−, vs semaine précédente et moyenne 4 sem. |
| `get_activities(from, to, limit)` | Sorties dédupliquées (durée, distance, D+, FC, RPE, GAP) |
| `get_activity_detail(id)` | Détail d'une sortie : zones de FC, côtes, allure ajustée |
| `get_recovery(from, to)` | HRV, FC repos, sommeil face à la base ; avis de la montre étiquetés |
| `get_fitness(from, to)` | CTL / ATL / TSB (courbes de tendance) |
| `get_plan(week)` | Programme de la semaine, prévu vs réalisé |
| `export_markdown(from, to)` | Le même Markdown que « Copier pour Claude » |

Dates au format `AAAA-MM-JJ`. Chaque résultat indique son niveau de preuve (mesure, indicatif, non
validé, avis de la montre). Les descriptions des outils sont en français.

## Option 1 — HTTP sur le tailnet (recommandé)

Le service `mcp` du `docker-compose` est publié par Caddy sur `https://coach.himitris.fr/mcp`
(certificat valide, accessible uniquement depuis votre tailnet).

1. (Facultatif) verrouiller par un jeton partagé : dans `deploy/.env`, `MCP_TOKEN=<longue valeur aléatoire>`
   (par exemple `openssl rand -hex 32`), puis `docker compose up -d`. Sans `MCP_TOKEN`, aucun
   verrouillage (l'accès reste limité au tailnet). Le jeton n'est jamais journalisé.
2. Sur le PC (Tailscale actif), configurer Claude Desktop (menu *Settings → Developer → Edit Config*,
   fichier `claude_desktop_config.json`). Claude Desktop lance un petit pont qui parle HTTP :

```json
{
  "mcpServers": {
    "coach-trail": {
      "command": "npx",
      "args": [
        "-y", "mcp-remote",
        "https://coach.himitris.fr/mcp",
        "--header", "Authorization:${AUTH_HEADER}"
      ],
      "env": { "AUTH_HEADER": "Bearer <votre MCP_TOKEN>" }
    }
  }
}
```

Sans jeton, retirer les deux lignes `--header` / `env`. Selon la version de Claude Desktop, une URL
de serveur MCP distant peut aussi se déclarer directement ; l'adresse est toujours
`https://coach.himitris.fr/mcp` et l'en-tête `Authorization: Bearer <jeton>`.

3. Redémarrer Claude Desktop : les 8 outils apparaissent. Essayer : « Résume ma semaine ».

## Option 2 — stdio (sans exposer le service HTTP)

Claude Desktop lance le serveur dans le conteneur, via SSH sur la machine qui héberge Coach Trail :

```json
{
  "mcpServers": {
    "coach-trail": {
      "command": "ssh",
      "args": [
        "utilisateur@coach.himitris.fr",
        "cd coach-trail/deploy && docker compose exec -T mcp python -m app.mcp_server --transport stdio"
      ]
    }
  }
}
```

(Le jeton ne s'applique qu'au transport HTTP ; en stdio l'accès est celui de votre session SSH.)

## En développement

```bash
cd backend
python -m app.mcp_server --transport stdio                       # API sur MCP_API_URL (défaut http://127.0.0.1:8000)
python -m app.mcp_server --transport http --port 8765            # http://127.0.0.1:8765/mcp
npx @modelcontextprotocol/inspector python -m app.mcp_server     # inspecter les outils
```

## Sécurité

- Lecture seule par construction : l'interface `ReadApi` n'a qu'une méthode `get`, tous les outils
  sont déclarés `readOnlyHint`, et les tests vérifient qu'aucune requête autre que `GET` n'est émise
  et qu'aucune donnée ne change après l'appel des outils.
- Le transport HTTP refuse les `Host` inconnus (protection contre le rebinding DNS) : variable
  `MCP_ALLOWED_HOSTS` (défaut : `localhost`, `127.0.0.1`, votre `DOMAIN`).
- Le service n'a aucun port publié : seul Caddy, lié à l'IP Tailscale, le dessert.
- Les données de santé restent à usage strictement personnel : n'activez le serveur que sur des
  appareils de votre tailnet.
