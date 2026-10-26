# 11 — Intervals.icu et repli automatique

Lis `CLAUDE.md`. Implémente `IntervalsConnector` (interface `SourceConnector`) et la logique de repli.

## À faire
1. API Intervals.icu (auth Basic `API_KEY:<clé>`, `INTERVALS_ATHLETE_ID`) : activités, flux (FC, allure, altitude), wellness (HRV, sommeil, FC repos, poids), CTL/ATL fournis par Intervals (stockés à part, **non utilisés** à la place du calcul interne ; seulement comparaison), calendrier. Normalisation vers les mêmes tables que Garmin, `source='intervals'`.
2. **Repli** : si Garmin est en `down`/`auth_required`/erreur, le `SyncService` appelle Intervals.icu pour séances et bien-être, sans erreur bloquante. Badge « Garmin indisponible depuis le … » (déjà prévu dans l'UI), dernières valeurs conservées. Retour automatique à Garmin dès que `healthcheck` repasse, avec comblage des jours manquants.
3. Les séances présentes dans les deux sources sont fusionnées par la déduplication (prompt 03) : la version Garmin prévaut, la version Intervals comble les champs manquants.
4. Champs propriétaires Garmin (Training Readiness, Body Battery) restent vides pendant un repli et l'UI le dit clairement (« non disponible via Intervals.icu »).
5. Tests : fixtures Intervals, scénario complet « Garmin coupé → bascule → Garmin revient », absence de doublons, absence d'erreur utilisateur.

## Critères d'acceptation
Critère du cahier : en coupant l'accès Garmin, l'appli reste utilisable et signale l'indisponibilité. Commit : `feat(intervals): connecteur Intervals.icu + repli`.
