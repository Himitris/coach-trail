# Prompts de construction — Coach Trail

À exécuter **dans l'ordre**, un par session Claude Code, depuis la racine du projet. Chaque prompt suppose que `CLAUDE.md` est lu et que les précédents sont terminés (tests verts, commit fait).

| # | Fichier | Phase | Résultat |
|---|---------|-------|----------|
| 01 | 01-socle-infra.md | 0 | Docker Compose, Caddy HTTPS DNS-01, page de test via Tailscale |
| 02 | 02-backend-base.md | 1 | FastAPI, SQLite, migrations, config, /health |
| 03 | 03-sync-framework.md | 1 | Framework de sync, stockage brut + normalisé, planificateur, santé des sources |
| 04 | 04-garmin-connector.md | 1 | Connecteur Garmin + écran de reconnexion |
| 05 | 05-metriques-phase1.md | 1 | Volume, zones, sRPE, CTL/ATL/TSB, récupération |
| 06 | 06-saisies-et-plan.md | 1 | Saisie du soir, programme de la semaine |
| 07 | 07-frontend-dashboard.md | 1 | Dashboard modulaire multi-pages |
| 08 | 08-widgets-phase1.md | 1 | Widgets de phase 1 |
| 09 | 09-export-markdown.md | 1 | « Copier pour Claude » |
| 10 | 10-sauvegardes-recette-p1.md | 1 | Sauvegardes, tests de bout en bout, recette MVP |
| 11 | 11-intervals-repli.md | 2 | Connecteur Intervals.icu, repli, déduplication |
| 12 | 12-metriques-phase2.md | 2 | Monotonie/tension, GAP, D-, nutrition, courbatures |
| 13 | 13-widgets-phase2.md | 2 | Widgets phase 2 |
| 14 | 14-import-plan-exports.md | 2 | Import plan JSON, exports JSON/CSV |
| 15 | 15-api-lecture-mcp.md | 3 | API GET /export + serveur MCP |
| 16 | 16-confort-phase3.md | 3 | Strava, matériel, météo, PWA, verrouillage |

Règle commune à tous : ne rien ajouter hors périmètre du prompt, ne jamais mettre de secret dans le code/logs, écrire les tests, finir par un commit clair.
