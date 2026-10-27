# Prompt 18 — Plans rattachés aux courses, page Courses (V2)

Lis `CLAUDE.md` et `docs/Cahier des charges – Coach Trail.docx` (section 10, V2). Prérequis : 17 terminé.

## À faire
1. **Migration versionnée** : table `plan` (`id`, `nom`, `date_debut`, `date_fin`, `goal_id` nullable → `goal`, `cree_le`) ; colonne `planned_session.plan_id` (nullable, index). Les séances existantes → un plan « Plan importé » (dates min/max). Test de migration sur une base V1 remplie.
2. **API** : `GET/POST/PUT/DELETE /plans`, `PUT /plans/{id}/course` (attribuer / détacher). Suppression d'un plan = ses séances non réalisées supprimées, les séances ayant une activité associée gardées détachées (plan_id NULL) — documenter. Le plan d'une séance est exposé dans `/plan/week`.
3. **Import de plan** (`backend/app/plan/importer.py`) : accepter `{"version":2,"plan":{"nom","course"?},"sessions":[…]}` en plus du V1 (V1 → plan nommé d'après la date de la première séance). `date_debut/fin` calculées. Aperçu : lister les séances en **chevauchement avec un autre plan** (elles ne sont pas écrasées sans confirmation explicite) ; règle « jour passé réalisé jamais touché » conservée. Course : par nom ou date (rapprochement avec `goal`), sinon non attribué.
4. **Page intégrée « Courses »** (`/courses`, non supprimable) remplaçant l'onglet « + Course » et la page d'exemple : cartes par course (date, compte à rebours, distance, D+, profil, plan attribué avec période et nombre de séances), création/édition d'une course, attribuer/détacher/supprimer un plan. Réutiliser `RaceGoalWidget` et les composants existants, ne pas dupliquer.
5. Retirer « + Course » de la barre d'onglets ; ajouter l'entrée « Courses » (raccourci visuel dans la barre, à droite).
6. Mettre à jour `docs/plan-schema.json`, `docs/plan-exemple.json` et `docs/prompt-plan-claude.md` (champ `plan`, version 2).

## Fin
Tests backend (migration, import V1/V2, chevauchement, attribution) et frontend verts ; un commit `feat(v2): plans rattachés aux courses, page Courses`.
