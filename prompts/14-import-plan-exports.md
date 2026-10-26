# 14 — Import de plan JSON et exports JSON/CSV

Lis `CLAUDE.md`.

## À faire
1. **Schéma de plan versionné** `docs/plan-schema.json` (JSON Schema, `version: 1`) : liste de séances `{date, type, duree_min, zone_cible, dplus_cible, objectif, consignes}`. Fournir un exemple `docs/plan-exemple.json` et un court texte `docs/prompt-plan-claude.md` que l'utilisateur colle dans Claude pour obtenir un plan au bon format.
2. **Import** : `POST /api/plan/import?dry_run=true|false` — validation stricte (erreurs ligne par ligne en français), aperçu des créations/remplacements, puis enregistrement transactionnel. Ne touche jamais aux séances passées déjà réalisées sans confirmation explicite. Frontend : écran d'import (glisser-déposer du fichier, aperçu, confirmer).
3. **Export JSON** avec schéma versionné (`schema_version`), mêmes périmètres que l'export Markdown : profil, période, séances, récupération, plan, saisies, glossaire. Flux sous-échantillonnés en pièce jointe séparée.
4. **Export CSV** pour les séries : HRV quotidienne, charge (CTL/ATL/TSB), séances, bien-être ; en-têtes explicites, séparateur `,`, dates ISO.
5. Frontend : sélecteur de format (md/json/csv) sur le bouton d'export global et sur chaque widget.
6. Tests : validation de schéma (cas valides/invalides), import idempotent, snapshots JSON/CSV.

## Critères d'acceptation
Un plan produit par Claude à partir du prompt fourni s'importe sans erreur. Commit : `feat(plan): import JSON, exports JSON/CSV (fin phase 2)`.
