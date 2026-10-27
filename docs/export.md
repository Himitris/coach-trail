# Exports de Coach Trail

Rien n'est envoyé automatiquement : l'export est produit à la demande (bouton « Copier pour Claude »
de l'en-tête, boutons de chaque widget et de chaque séance) ou par l'API de lecture.

| Format | Contenu | Où |
|---|---|---|
| **Markdown** | Résumé lisible : profil, période, séances, plan prévu vs réalisé, récupération, saisies, glossaire des niveaux de preuve, limites. | `GET /api/export?from=&to=` |
| **JSON** | Mêmes périmètres, structure versionnée (`schema_version`, schéma publié dans `docs/export-schema.json`). Les flux de séance ne sont **pas** dedans. | `GET /api/export?format=json` |
| **Flux** | Flux de séance sous-échantillonnés (1 point toutes les 45 s) en fichier JSON séparé, référencé par `streams_url`. | `GET /api/export/streams?from=&to=` |
| **CSV** | Une série par fichier : en-têtes explicites (unités dans le nom), séparateur `,`, UTF-8, point décimal, dates `AAAA-MM-JJ`, cellule vide = donnée absente. | `GET /api/export?format=csv&series=…` |

## Séries CSV

`activities` (séances), `wellness` (HRV, FC repos, sommeil, avis de la montre), `hrv`, `load`
(charge, CTL/ATL/TSB), `intensity` (minutes par zone et par semaine), `monotony`, `fatigue` (D−
hebdomadaire), `strength`, `fueling` (nutrition des sorties longues), `plan` (prévu vs réalisé),
`entries` (saisies du soir). Les colonnes sont listées dans la première ligne de chaque fichier et
dans le champ `columns` de la version JSON d'une série.

Les cellules de texte qui commencent par `=`, `+`, `-` ou `@` sont préfixées d'une apostrophe pour
éviter l'exécution de formules à l'ouverture dans un tableur.

## Par widget

`GET /api/export/widget/{id}?format=md|json|csv` : Markdown du cadre, ou sa série (JSON
`{schema_version, series, columns, rows}` / CSV). Les widgets sans série tabulaire (note libre,
objectif de course) répondent 422 en JSON/CSV.

## Par séance

`GET /api/export/activity/{id}?format=md|json`.

## Import d'un plan

`POST /api/plan/import?dry_run=true|false&confirm_past_done=false` : voir `docs/plan-schema.json`,
`docs/plan-exemple.json` et `docs/prompt-plan-claude.md`. Écran : « Importer un plan ».
