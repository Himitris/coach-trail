# 09 — Export « Copier pour Claude » (Markdown)

Lis `CLAUDE.md`. Rien n'est envoyé automatiquement : l'utilisateur colle ou joint le résultat.

## À faire
1. Backend `backend/app/export/` : `build_export(from, to, scope)` → structure intermédiaire, puis rendu Markdown. Endpoint `GET /api/export?from=&to=&format=md`.
2. Contenu du Markdown (français, quelques milliers de mots max) :
   - **Profil athlète** : FC max, zones, seuils, objectifs et dates de course, jours restants.
   - **Période** (7 j / 4 sem. / 12 sem. / plage libre) : volume, intensités (réalisé vs cible), séances avec leurs indicateurs, plan prévu vs réalisé.
   - **Récupération** : HRV (7 j vs base), FC repos, sommeil, saisies du soir et notes, mentions « malade ».
   - **Glossaire des métriques avec niveau de preuve** (ACWR non validé, scores Garmin propriétaires, CTL/ATL simplifié, HRV en tendance…) pour que Claude n'interprète pas un indicateur comme une vérité.
   - Résumé des limites : données manquantes, source utilisée (Garmin / repli Intervals.icu).
3. Flux de séance **sous-échantillonnés** (un point toutes les 30–60 s) fournis dans un fichier JSON séparé téléchargeable ; le Markdown le référence.
4. Export par widget et par séance : `GET /api/export/widget/{id}` et `/api/export/activity/{id}`, branchés sur `exportData()` du registre.
5. Frontend : bouton global « Copier pour Claude » (choix de période, copie dans le presse-papiers, toast de confirmation, lien de téléchargement du JSON complet) + boutons d'export de chaque cadre et de chaque séance.
6. Tests : snapshot du Markdown sur jeu de données fixe, taille maîtrisée, aucune donnée absente inventée, aucun secret.

## Critères d'acceptation
Export en deux clics depuis l'accueil. Commit : `feat(export): copier pour Claude (markdown)`.
