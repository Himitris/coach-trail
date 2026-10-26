# 03 — Framework de synchronisation

Lis `CLAUDE.md` (section sources de données). Construis le cadre de sync **sans connecteur réel** (les connecteurs viennent aux prompts 04 et 11).

## À faire
1. Migrations :
   - `raw_payload` (source, type, clé externe, date de récupération, JSON brut, hash) avec contrainte unique (source, type, clé externe) → upsert idempotent.
   - Tables normalisées : `activity` (source, id externe, sport, début UTC, durée, distance, D+, D-, FC moy/max, calories, shoe/gear nullable, `dedup_group_id`), `activity_stream` (activity_id, échantillons compressés : t, fc, altitude, vitesse, distance, cadence), `wellness_daily` (date, hrv_nuit, hrv_base_min/max, fc_repos, sommeil_durée, sommeil_efficacité, stress, spo2, training_readiness, body_battery_max/min, poids, source), `source_status` (source, dernière sync réussie, dernière erreur, message, depuis quand indisponible).
2. Interface `SourceConnector` (Protocol) : `fetch_activities(since)`, `fetch_activity_stream(id)`, `fetch_wellness(since)`, `healthcheck()`. Les connecteurs retournent des payloads bruts ; des fonctions `normalize_*` par source les convertissent.
3. `SyncService` : exécute un connecteur → écrit les bruts (upsert) → reconstruit les tables normalisées depuis les bruts (commande `rebuild-normalized` sans rappeler les API). Idempotence prouvée par test (deux sync identiques = 0 doublon).
4. Déduplication inter-sources : même début à ±60 s et durée voisine (±5 %) → même `dedup_group_id`, priorité de la source selon l'ordre configurable (Garmin > Intervals.icu > Strava).
5. Planificateur APScheduler intégré : sync nocturne (heure configurable, défaut 03:30), `POST /api/sync/run` pour « synchroniser maintenant » (asynchrone, un seul run à la fois), `GET /api/sync/status`.
6. `GET /api/sources/health` pour la page « Santé des sources » : dernière réussite, dernière erreur, badge d'indisponibilité. Une erreur de source n'interrompt jamais l'API ni ne vide les données.
7. Limiteur de débit générique lisant des en-têtes de quota (utile pour Strava plus tard).
8. Un `FakeConnector` de test avec données de fixture, utilisé par les tests.

## Critères d'acceptation
Tests : idempotence, déduplication, reconstruction depuis bruts, échec de source sans perte de données, verrou de sync concurrente. Commit : `feat(sync): framework de synchronisation`.
