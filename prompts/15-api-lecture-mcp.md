# 15 — API de lecture et serveur MCP (phase 3)

Lis `CLAUDE.md`. Accès direct par Claude, **lecture seule**, uniquement sur le réseau Tailscale.

## À faire
1. API : `GET /export?from=&to=&format=md|json|csv` (réutilise `build_export`), plus `GET /export/activity/{id}`. Aucun endpoint d'écriture exposé via cette porte.
2. **Serveur MCP** `backend/app/mcp_server.py` (SDK MCP Python officiel), transport stdio ET streamable HTTP sur le réseau Tailscale. Outils en lecture seule : `get_profile`, `get_week_summary(date)`, `get_activities(from,to)`, `get_activity_detail(id)`, `get_recovery(from,to)`, `get_fitness(from,to)`, `get_plan(week)`, `export_markdown(from,to)`. Descriptions en français, sorties compactes avec niveau de preuve.
3. Verrouillage optionnel par jeton partagé (en-tête `Authorization: Bearer`), jeton lu dans l'environnement, désactivé par défaut.
4. Documentation `docs/mcp.md` : configuration de Claude Desktop sur le PC connecté à Tailscale (fichier de config d'exemple), rappel qu'un connecteur distant hébergé chez Anthropic ne peut pas joindre l'appli.
5. Tests : outils MCP sur base de fixtures, vérification qu'aucune opération d'écriture n'est possible, test du jeton.

## Critères d'acceptation
Claude Desktop liste les outils et répond à « résume ma semaine » avec des données réelles. Commit : `feat(mcp): API de lecture + serveur MCP`.
