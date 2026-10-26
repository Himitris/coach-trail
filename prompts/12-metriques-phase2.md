# 12 — Métriques et saisies de phase 2

Lis `CLAUDE.md` (règles métriques). Étends `backend/app/metrics/` et les saisies.

## À faire
1. **Monotonie et tension** : monotonie = moyenne ÷ écart-type des charges quotidiennes (sur 7 j), tension = charge × monotonie ; série hebdomadaire ; repère à 2 ; alerte **douce** (information) si monotonie > 2 avec charge élevée ; libellé `evidence` : observationnel, petit échantillon, jamais prédicteur de blessure.
2. **Allure ajustée à la pente (GAP/NGP)** depuis les flux avec un modèle de coût énergétique documenté (citer la formule dans le code), vitesse ascensionnelle (m/h) sur les montées, découpage par côtes. Le détail de séance (widget) l'utilise.
3. **Fatigue musculaire** : D- hebdomadaire, séances à fort D-, courbatures à 48 h (lien entre séance et saisie à J+2), suggestion informative « 2–3 jours faciles après descente intense ».
4. **Nutrition** : table `fueling_entry` (activity_id, glucides_g_par_h, score digestif 0–5, note) ; API CRUD ; série par sortie longue (> 2,5 h ou paramètre) pour suivre la montée progressive ; l'appli enregistre, elle ne prescrit pas.
5. **Renforcement** : détection/saisie des séances de renforcement par semaine, objectif fixé par l'utilisateur.
6. **Objectif de course** : jours restants, volume des 4 dernières semaines vs profil (distance/D+) de la course, prédictions Garmin affichées comme estimations de la montre, TSB projeté à la date de course (courbe de tendance).
7. Course du jour : exclue des comparaisons de FC.
8. Endpoints associés + tests sur données synthétiques (valeurs attendues calculées à la main).

## Critères d'acceptation
Tests verts, chaque métrique expose `evidence`. Commit : `feat(metrics): métriques et saisies phase 2`.
