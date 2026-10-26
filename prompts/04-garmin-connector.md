# 04 — Connecteur Garmin

Lis `CLAUDE.md`. Implémente `GarminConnector` (interface `SourceConnector` du prompt 03) avec la bibliothèque `garminconnect` (python-garminconnect), version **épinglée** dans les dépendances.

## À faire
1. Authentification : script CLI `python -m app.cli garmin-login` qui demande email, mot de passe et code MFA **en interactif**, obtient les jetons, les enregistre dans `GARMIN_TOKEN_DIR` (droits 600) et **ne conserve jamais le mot de passe**. Équivalent API : `POST /api/garmin/login` (email, mot de passe, MFA en deux étapes) pour l'écran de reconnexion ; le mot de passe n'est ni loggé ni persisté.
2. Récupération : activités (liste + détail + flux seconde par seconde, FC/altitude/vitesse/distance/cadence), sommeil (durée, efficacité, phases), HRV nocturne + plage de référence + statut, FC repos, stress, SpO2, Body Battery, Training Readiness, statut d'entraînement, prédictions de course, zones FC, seuil lactique, poids. Historique initial configurable (défaut 12 mois) puis incrémental.
3. Résilience : retries avec backoff, délais aléatoires entre appels, détection des erreurs d'authentification/anti-bot (429, 403, jeton expiré) → statut `auth_required` dans `source_status`, sans crash. Les champs absents ou renommés donnent `None` + warning, jamais d'exception fatale.
4. Mise à jour automatique de `athlete_profile` (FC repos, seuil lactique, zones) depuis Garmin quand disponible.
5. Pour la page « Santé des sources » : statuts `ok`, `degraded`, `auth_required`, `down`, avec message lisible.
6. Tests unitaires sur des **fixtures JSON** de réponses Garmin (anonymisées) pour la normalisation ; aucun test n'appelle le réseau. Documenter dans `backend/README.md` comment capturer de nouvelles fixtures.

## Critères d'acceptation
Normalisation testée sur fixtures ; échec d'auth → `auth_required` et API toujours fonctionnelle ; aucun secret dans les logs (test). Commit : `feat(garmin): connecteur Garmin + login`.
