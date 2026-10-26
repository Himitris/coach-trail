# 16 — Confort (phase 3, à la demande)

Lis `CLAUDE.md`. Quatre blocs indépendants, à faire dans des commits séparés ; demande lequel traiter si la session n'est pas explicite.

## A. Strava (optionnel)
Connecteur OAuth2 (activités, flux), désactivé par défaut. Limiteur de débit basé sur les en-têtes de quota (200 req/15 min, 2000/jour), ralentissement avant blocage. Avertissement dans l'UI et le README : lire les conditions API Strava du 1er juin 2026 (interdiction d'entraîner une IA) avant activation. Déduplication avec Garmin déjà en place (priorité la plus basse).

## B. Matériel
Kilométrage par paire de chaussures (depuis Garmin gear ou affectation manuelle), seuil d'usure réglable, alerte douce, widget « Matériel ».

## C. Météo
Widget « Météo du jour de sortie » via un service gratuit sans clé (Open-Meteo), lieu configurable, séance prévue du jour.

## D. Confort d'usage
PWA installable sur l'écran d'accueil du téléphone (manifest, service worker, icônes, cache de lecture hors ligne de la dernière disposition) ; verrouillage simple optionnel (code ou en-tête, désactivé par défaut) ; import manuel FIT/GPX (parse, normalisation, déduplication).

## Critères d'acceptation
Tests pour chaque bloc, aucune régression sur les phases 1–2, secrets jamais journalisés. Commits : `feat(strava)`, `feat(gear)`, `feat(weather)`, `feat(pwa)`.
