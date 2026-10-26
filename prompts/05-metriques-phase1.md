# 05 — Moteur de métriques (phase 1)

Lis `CLAUDE.md` (règles métriques). Crée `backend/app/metrics/` : fonctions **pures**, testées, alimentées par les tables normalisées. Chaque métrique expose une valeur, une tendance et un champ `evidence` (niveau de preuve + une phrase) que l'UI et l'export réutilisent.

## À faire
1. **Volume** : temps hebdo (base), distance, D+, D-, D+/km ; comparaison vs semaine précédente et vs moyenne 4 semaines ; variation hebdo du temps en % avec repère +10 % (information, jamais alerte de blessure).
2. **Intensité** : temps par zone de FC (5 zones du profil) recalculé depuis les flux ; part « bas d'intensité » (zones 1–2) vs cible 75–80 %, par semaine ; réalisé vs cible, sans jugement à la séance.
3. **sRPE** : charge séance = RPE × durée (min) à partir des saisies (table `evening_entry` créée au prompt 06 ; ici prévoir l'interface de lecture).
4. **CTL / ATL / TSB** : charge quotidienne issue des séances Garmin (TRIMP par FC, formule documentée, basée sur FC repos/max/seuil du profil), moyennes exponentielles 42 j / 7 j, TSB = CTL − ATL, rampe de CTL sur 4 semaines. Recalculable depuis zéro ; avertir si le seuil FC est ancien.
5. **Récupération** : HRV moyenne 7 j vs base 30–60 j (écart en % et en écart-type, **pas de seuil feu vert/rouge**) ; FC repos 7 j vs base ; sommeil durée/efficacité moyenne 7 j ; Training Readiness et Body Battery exposés tels quels, étiquetés « avis Garmin, non validé ».
6. **ACWR** : non calculé comme alerte ; si exposé, uniquement la valeur Garmin avec le libellé « non validé ».
7. Exclusion des courses (flag `is_race`) des comparaisons de FC entre séances.
8. API : `GET /api/metrics/week?date=`, `/api/metrics/intensity?weeks=`, `/api/metrics/fitness?from=&to=`, `/api/metrics/recovery?days=`.

## Critères d'acceptation
Tests sur jeux de données synthétiques avec valeurs attendues calculées à la main (CTL/ATL, zones, variations), cas limites (semaine vide, données manquantes, un seul jour). Commit : `feat(metrics): métriques phase 1`.
