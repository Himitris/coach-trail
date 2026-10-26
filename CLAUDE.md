# Coach Trail — contexte projet

Appli web perso, 1 utilisateur, sans compte. Hébergée dans un conteneur Proxmox, accessible uniquement par Tailscale sur `coach.himitris.fr`. Elle centralise activités/sommeil/HRV/FC repos/charge, les affiche dans un tableau de bord modulaire (widgets déplaçables, multi-pages) et exporte vers Claude. Langue de l'UI et des exports : français.

## Athlète
Objectifs : Trail des 3 Rocs (31 km, ~1600 m D+, 8 nov. 2026), Trail de Bruniquel (~39 km, mi-fév. 2027), ultras ensuite. Méthode 80/20, 6 jours de course/semaine, FC max 195. Matériel : Garmin FR955 + Polar H10, Intervals.icu alimenté par la montre.

## Stack (décidée, ne pas changer)
Python 3.12 + FastAPI · SQLite (migrations versionnées) · React + Vite + TypeScript + react-grid-layout · planificateur intégré (APScheduler) · Caddy + module DNS OVH (DNS-01) · Docker Compose.

## Sources de données
- **Garmin Connect** (bibliothèque non officielle python-garminconnect) = source principale. Fragile : jetons de session, MFA unique, écran de reconnexion.
- **Intervals.icu** (API, clé perso) = repli silencieux ; badge « Garmin indisponible depuis le … », garde les dernières valeurs.
- **Strava** = optionnel (phase 3). **FIT/GPX** = import manuel.
- Sync : nocturne + bouton « synchroniser maintenant ». Stockage en 2 couches : JSON bruts conservés + tables normalisées reconstruisibles. Idempotente. Déduplication inter-sources : départ ±60 s et durée voisine.
- L'UI lit uniquement la base locale.

## Règles métriques (importantes)
- Afficher les composantes avec leur tendance et un niveau de preuve ; **jamais de score unique maison**.
- **ACWR : pas d'alerte de blessure**, au mieux affiché en gris « non validé ».
- HRV : moyenne 7 j vs base 30–60 j, tendance, pas de feu vert/rouge quotidien.
- Hausse hebdo de temps ≈ +10 % comme repère de bon sens, jamais prédicteur de blessure.
- Intensité : zones 1–2 Garmin = « bas d'intensité », cible 75–80 % du temps.
- CTL/ATL/TSB (constantes 42/7 j) : courbe de tendance, pas un verdict.
- Training Readiness / Body Battery : avis de la montre, étiquetés propriétaires.
- Course du jour : FC de compétition non comparée aux séances.

## Sécurité
Aucun port public. Secrets en variables d'environnement, jamais dans Git ni dans les logs. Mot de passe Garmin non conservé. Export uniquement à la demande. Sauvegarde quotidienne sur disque distinct.

## Conventions
- Backend : `backend/app/`, tests pytest, typage strict, ruff. Frontend : `frontend/`, TypeScript strict.
- Chaque prompt de `prompts/` doit se terminer avec tests qui passent et un commit.
- Cahier des charges complet : `docs/Cahier des charges – Coach Trail.docx`.
