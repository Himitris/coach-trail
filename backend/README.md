# Backend — Coach Trail

FastAPI + SQLite (WAL) + Alembic. Les migrations s'appliquent au démarrage.

```bash
python -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/ruff check . && .venv/bin/mypy && .venv/bin/pytest
```

## Garmin Connect

Source principale, via la bibliothèque **non officielle** `python-garminconnect` (version épinglée
dans `pyproject.toml`). Elle peut casser sans préavis : jetons de session, MFA, protections
anti-robot.

### Première connexion (ou reconnexion)

```bash
# dans le conteneur api, ou en local avec GARMIN_TOKEN_DIR défini
python -m app.cli garmin-login
```

Le script demande email, mot de passe (non affiché) et code MFA, enregistre les jetons dans
`GARMIN_TOKEN_DIR/garmin_tokens.json` (droits 600, dossier 700) et **ne conserve jamais le mot de
passe**. Équivalent pour l'écran de reconnexion : `POST /api/garmin/login`

1. `{"email": "...", "password": "..."}` → `{"status": "ok"}` ou `{"status": "mfa_required", "ticket": "..."}`
2. `{"ticket": "...", "mfa_code": "123456"}` → `{"status": "ok"}`

Le ticket vit 10 minutes en mémoire, est à usage unique, et les tentatives sont limitées
(5 par 10 minutes) pour ne pas verrouiller le compte Garmin.

### États de la source (`GET /api/sources/health`)

| état | signification |
|------|---------------|
| `ok` | dernière synchronisation complète |
| `degraded` | synchronisation terminée mais certains appels ont échoué (détail dans `message`) |
| `auth_required` | jetons absents/expirés, ou 401/403/429 (anti-robot) : reconnexion nécessaire |
| `down` | Garmin injoignable ou en erreur ; les dernières données sont conservées |

En cas d'échec, les données déjà stockées ne sont jamais supprimées et l'API reste disponible.
Un échec partiel conserve les lots déjà reçus et la synchronisation suivante reprend après eux.

### Ce qui est récupéré

- Activités : liste + détail (brut), puis flux seconde par seconde (FC, altitude, vitesse,
  distance, cadence). Le brut du flux ne garde que ces canaux, sans tracé GPS.
- Par jour : résumé (FC repos, stress, Body Battery), sommeil, HRV nocturne + plage de référence,
  Training Readiness, poids. Statut d'entraînement et prédictions de course pour le jour courant
  (conservés dans le brut, non normalisés pour l'instant).
- Profil : zones FC et seuil lactique → `athlete_profile` (FC repos, seuil, zones). La FC max
  n'est jamais modifiée par la synchronisation.
- Historique initial : `GARMIN_HISTORY_MONTHS` (défaut 12), puis incrémental (recouvrement 3 jours).
  Le premier passage fait ~4 appels par jour avec une pause aléatoire de 1 à 3 s entre appels
  (`GARMIN_MIN_DELAY_S`, `GARMIN_MAX_DELAY_S`) : prévoir environ une heure pour 12 mois.
- L'« efficacité du sommeil » est une estimation (temps endormi / fenêtre de sommeil) : Garmin ne la
  fournit pas.

## Capturer de nouvelles fixtures Garmin

Les fixtures de `tests/fixtures/garmin/` sont **synthétiques** (écrites d'après la structure
documentée de la bibliothèque). Pour les remplacer par des réponses réelles :

```python
# script jetable, hors dépôt
import json
from garminconnect import Garmin

api = Garmin()
api.login(tokenstore="/data/garmin_tokens")
day = "2026-10-04"
captures = {
    "sleep.json": api.get_sleep_data(day),
    "hrv.json": api.get_hrv_data(day),
    "user_summary.json": api.get_user_summary(day),
    "training_readiness.json": api.get_training_readiness(day),
    "heart_rate_zones.json": api.get_heart_rate_zones(),
    "lactate_threshold.json": api.get_lactate_threshold(latest=True),
}
acts = api.get_activities_by_date(day, day)
if acts:
    aid = str(acts[0]["activityId"])
    captures["activity_summary.json"] = acts[0]
    captures["activity_detail.json"] = api.get_activity(aid)
    captures["activity_details.json"] = api.get_activity_details(aid, maxchart=200, maxpoly=0)
for name, data in captures.items():
    json.dump(data, open(name, "w"), indent=2, ensure_ascii=False)
```

Avant de commiter, **anonymiser** : remplacer `userProfilePK`, `userProfileId`, `activityId`,
`deviceId`, noms d'activité, `ownerDisplayName`/`ownerFullName`, coordonnées GPS
(`startLatitude`, `startLongitude`, `locationName`), dates ramenées à 2026-10-04 si besoin, et
vérifier avec `grep -rniE 'mail|@|token|latitude|longitude' tests/fixtures/garmin`. Réduire
`activityDetailMetrics` à quelques échantillons. Aucun test ne doit appeler le réseau.

## Saisies du soir et programme

- `PUT /api/entries/{date}` : tout est optionnel, seuls les champs fournis changent (`null` efface).
  `courbatures` (0–10), `malade`, `note` (une saisie par jour) ; `rpe` (0–10) = raccourci pour la
  séance du jour quand il n'y en a qu'une, sinon `sessions: [{activity_id, rpe}]`. Une seule saisie
  de RPE par séance réelle (doublons montre / Intervals.icu pris en compte). Dates futures refusées.
  `GET /api/entries?from=&to=` (30 derniers jours par défaut). Le RPE alimente la charge sRPE
  (RPE × minutes) de `/api/metrics/week`.
- `/api/plan/sessions` (CRUD, `type` : footing, cotes, seuil, longue, fractionne, course, renfo,
  repos, autre ; `zone_cible` « 2 » ou « 1-2 ») et `GET /api/plan/week?date=`. Descriptions
  uniquement : rien n'est envoyé à la montre.
- Les identifiants d'activité sont conservés par `rebuild-normalized` ; une saisie dont l'activité
  aurait disparu est rattachée à nouveau d'après l'heure de début (±60 s).
- Données de développement : `python -m app.cli seed-demo [--week AAAA-MM-JJ] [--force]`.

### Règle de rapprochement prévu / réalisé

Voir `app/plan/matching.py` (testée dans `tests/test_plan_matching.py`) :

1. Séances réalisées d'un jour = activités dédupliquées de ce **jour local** (minuit local).
2. Une séance prévue ne se rapproche que d'un sport compatible : course à pied pour footing / côtes /
   seuil / longue / fractionné / course ; renforcement, fitness, HIIT, cardio indoor, pilates, yoga
   pour renfo ; tout sport pour « autre ». Une activité marquée course est acceptée pour tous les
   types de course à pied.
3. Plusieurs séances prévues le même jour : de la plus longue à la plus courte, chacune prend
   l'activité libre compatible dont la durée est la plus proche (une activité n'est utilisée qu'une
   fois ; égalité : la plus tôt).
4. Statuts : rapprochée → `partiel` si durée < 80 % du prévu, sinon `fait` ; non rapprochée →
   `manqué` (jour passé) ou `à venir` (aujourd'hui et futur) ; repos prévu → `imprévu` s'il y a une
   sortie, `fait` si le jour est passé sans activité, `à venir` sinon ; activité sans séance
   prévue → `imprévu`.
5. Écarts = réalisé − prévu (durée en minutes, D+ en mètres), absents si une valeur manque.

## Sorties et séries pour les widgets

- `GET /api/activities?from=&to=&limit=&group=all|run|trail|other&races_only=` : sorties
  dédupliquées (source prioritaire), avec RPE saisi et allure moyenne. `gap_s_per_km` vaut `null`
  tant que l'allure ajustée à la pente n'est pas calculée (phase 2).
- `GET /api/activities/{id}` : détail avec flux réduit à ≤ 500 points (moyenne par paquets), allure
  tirée de la vitesse, temps par zone (zones du profil) et **côtes** détectées sur le profil lissé
  (`app/metrics/climbs.py` : dénivelé net ≥ 50 m, pente moyenne ≥ 3 %, hystérésis 20 m).
- `GET /api/metrics/wellness?days=` : valeurs quotidiennes (HRV, FC repos, sommeil, Training
  Readiness, Body Battery) pour les courbes ; uniquement les jours reçus, rien d'interpolé.

## Sauvegardes

`app/backup.py` : copie quotidienne de la base (API `backup` de SQLite + `PRAGMA integrity_check`), rotation 7/4/6 et restauration. Planifiée par l'application à `BACKUP_TIME` (défaut 04:30) vers `BACKUP_DIR`.

```bash
python -m app.cli backup                    # sauvegarde immédiate
python -m app.cli restore /backup/daily/coach-2026-10-15.db   # API arrêtée ; utiliser deploy/restore.sh
```

État : `GET /api/backup/status` (lecture seule). Tests : `tests/test_backup.py`, `tests/test_security.py`, et le parcours complet `tests/e2e_server.py` (utilisé par `npm run e2e`).

## Intervals.icu et repli automatique

`app/intervals/` : connecteur de l'API Intervals.icu (auth Basic `API_KEY:<clé>`, `INTERVALS_ATHLETE_ID` et `INTERVALS_API_KEY` dans l'environnement ; actif seulement s'ils sont renseignés). Activités, flux (FC, altitude, vitesse, distance), bien-être (HRV, FC repos, sommeil, poids, SpO2) et calendrier (conservé brut, le plan vit dans l'appli). Normalisation vers les mêmes tables que Garmin, `source='intervals'`.

- **Repli** : Intervals.icu n'est appelé que si Garmin échoue (`down`, `auth_required`, erreur). Le run ne lève jamais d'erreur ; l'échec est dans le rapport et dans `source_status` (badge « Garmin indisponible depuis le … »). La fenêtre de repli démarre à la dernière réussite de Garmin.
- **Retour** : dès que Garmin répond, il repart de sa dernière réussite (jours manquants comblés) et Intervals.icu redevient muet.
- **Fusion** : une séance présente dans les deux sources (début ±60 s, durée ±5 %) n'apparaît qu'une fois ; la version Garmin prévaut, Intervals.icu comble les champs vides (distance, D+, D−, FC, calories, matériel) et le flux si Garmin n'en a pas. La base n'est jamais modifiée par cette fusion.
- **Propriétaire Garmin** : Training Readiness, Body Battery et plage HRV restent vides pendant un repli ; `GET /api/metrics/recovery` renvoie `fallback` et l'UI le dit (« non disponible via Intervals.icu »).
- **CTL/ATL d'Intervals.icu** : stockés à part (`wellness_daily.source_ctl/source_atl`), exposés dans `reference` de `GET /api/metrics/fitness` pour comparaison ; **jamais** utilisés à la place du calcul interne.
- Durée d'une séance Intervals.icu = `moving_time` (≈ chronomètre de la montre), pour rester dans la tolérance de déduplication.

Tests : `tests/test_intervals.py` (faux serveur `httpx.MockTransport`, scénario « Garmin coupé → bascule → Garmin revient »).

## Métriques et saisies de phase 2

Chaque métrique expose un `evidence` (niveau de preuve + une phrase), aucune n'est un score unique ni un prédicteur de blessure.

| Endpoint | Contenu |
|---|---|
| `GET /api/metrics/monotony?weeks=12` | Monotonie (moyenne ÷ écart-type des 7 charges quotidiennes) et tension (charge × monotonie) par semaine ; repère à 2 ; **alerte douce** (information) si monotonie > 2 et charge > 110 % de la moyenne des 4 semaines précédentes. |
| `GET /api/activities/{id}` | Ajoute `gap_s_per_km`, `ngp_s_per_km`, `ascent_speed_m_per_h` et `vam_m_per_h` par côte. `GET /api/activities` renseigne `gap_s_per_km`. |
| `GET /api/metrics/fatigue?weeks=8` | D− hebdomadaire, séances à fort D− (≥ 800 m, ou ≥ 400 m et ≥ 80 m/km), courbatures saisies à J+2, rappel informatif « 2 à 3 jours faciles » dans les 3 jours suivant une grosse descente. |
| `GET /api/metrics/strength?weeks=8` | Séances de renforcement par semaine (détectées + saisies, `max` par jour) face à l'objectif `renfo_objectif_hebdo` du profil (`PUT /api/profile`). |
| `GET/POST/DELETE /api/strength/sessions` | Séances de renforcement saisies à la main. |
| `GET /api/metrics/race-goal?goal_id=` | Prochaine course (ou celle choisie) : jours restants, 4 dernières semaines vs distance/D+ de la course, prédictions Garmin (estimations de la montre), TSB projeté à la date de course (repos complet / charge récente maintenue). |
| `GET/POST/PUT/DELETE /api/fueling`, `GET /api/fueling/series?min_hours=2.5` | Nutrition en sortie (glucides g/h, score digestif 0–5, note) ; série des sorties longues et variation vs la sortie longue renseignée précédente. L'appli enregistre, elle ne prescrit pas. |

**GAP / NGP** (`app/metrics/gap.py`) : coût énergétique de Minetti et al. (2002), `C(i) = 155,4 i⁵ − 30,4 i⁴ − 43,3 i³ + 46,3 i² + 19,5 i + 3,6` (J/kg/m, pente `i` en fraction) ; vitesse à plat équivalente `v × C(i)/3,6`. GAP = temps en mouvement ÷ distance équivalente ; NGP = moyenne d'ordre 4 des vitesses équivalentes lissées sur 30 s. Modèle moyen non individualisé.

La course du jour reste exclue des comparaisons de FC (intensités, zones) ; son allure (GAP) est calculée normalement. Tests : `tests/test_metrics_phase2.py` (valeurs calculées à la main) et `tests/test_phase2_api.py`.
