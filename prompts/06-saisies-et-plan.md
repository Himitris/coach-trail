# 06 — Saisie du soir et programme de la semaine

Lis `CLAUDE.md`. Ajoute les données saisies à la main et le plan d'entraînement stocké dans l'appli.

## À faire
1. Migrations + API :
   - `evening_entry` (date, activity_id nullable, rpe 0–10, courbatures 0–10, malade bool, note texte). Une entrée par jour max pour courbatures/malade/note ; RPE rattaché à une séance. `PUT /api/entries/{date}`, `GET /api/entries?from=&to=`. Validation stricte, saisie réalisable en 5 secondes (tout est optionnel).
   - `planned_session` (date, titre, type [footing, côtes, seuil, longue, renfo, repos…], objectif, durée_min, zone_cible, dplus_cible, consignes, statut calculé).
2. CRUD `/api/plan/sessions` + `GET /api/plan/week?date=` retournant pour chaque jour : séance prévue, séance(s) réalisée(s) rapprochées (même jour, sport compatible), écarts durée/D+, statut `fait / manqué / partiel / à venir / imprévu`.
3. Règle de rapprochement documentée et testée (séance réalisée la même date locale ; plusieurs séances ; jour de repos avec sortie).
4. Pas d'envoi à la montre : descriptions uniquement.
5. Seed de développement optionnel (`app.cli seed-demo`) avec une semaine type 80/20, 6 jours de course.

## Critères d'acceptation
Tests API + rapprochement prévu/réalisé. Commit : `feat(plan): saisies du soir et programme de la semaine`.
