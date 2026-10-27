# Prompt 19 — Calendrier navigable (V2)

Lis `CLAUDE.md` et `docs/Cahier des charges – Coach Trail.docx` (section 10, V2). Prérequis : 18 terminé.

## À faire
1. **Backend** : `GET /plan/range?from=&to=` → par jour : séances prévues (avec plan et couleur), activités réalisées (brèves), statut prévu/réalisé (réutiliser `plan/matching.py`). Plafonner l'intervalle à 62 jours. Courses du jour incluses.
2. **Page intégrée « Calendrier »** (`/calendrier`, non supprimable) : vue **semaine** (défaut) et **mois**, boutons précédent / suivant / aujourd'hui, état dans l'URL (`?vue=mois&date=…`), pastilles colorées par plan, marqueur de course. Clic sur un jour → panneau avec séances (objectif, consignes, zone, durée, D+) et activités ; édition/suppression de séance via les composants du widget Semaine (ne pas dupliquer). Lecture seule hors ces actions. Responsive (mobile : liste verticale).
3. **Widget « Semaine »** : ajouter flèches semaine précédente / suivante et « aujourd'hui » (`fetchPlanWeek(date)` existe déjà).
4. Accessibilité : navigation clavier dans la grille, `aria-label` des jours.
5. Respecter les règles métriques (pas de verdict, pas d'alerte blessure) ; le calendrier n'affiche que des faits.

## Fin
Tests (backend range ; frontend : navigation semaine/mois, jour avec plan + activité) verts ; un commit `feat(v2): calendrier semaine/mois navigable`.
