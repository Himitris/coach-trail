# 08 — Widgets de phase 1

Lis `CLAUDE.md` et le registre de widgets du prompt 07. Implémente les widgets de phase 1 branchés sur l'API de métriques (prompts 05–06). Graphiques avec une lib légère (Recharts ou uPlot). Chaque widget : réglages, export, états vide/erreur, et un petit libellé de niveau de preuve quand c'est une métrique discutable.

## Widgets
1. **Programme de la semaine** : séance du jour mise en avant, 7 jours avec statut fait/manqué/partiel/à venir, réalisé à côté du prévu ; clic pour éditer une séance.
2. **Charge de la semaine** : temps, distance, D+, D- vs semaine précédente et vs moyenne 4 semaines ; variation du temps vs repère +10 % présenté comme simple repère.
3. **Dernières sorties** : liste 5–10 (réglable) avec durée, distance, D+, FC moy, GAP si dispo, RPE ; clic → détail.
4. **Détail de séance** : profil altimétrique, FC, allure ajustée, temps par zone, découpage par côte ; choix de la séance (dernière par défaut).
5. **Répartition des intensités** : barres empilées par semaine, ligne de cible 75–80 % bas d'intensité.
6. **Forme (CTL/ATL/TSB)** : courbe 6 mois, rampe de CTL, jour de course marqué ; texte « tendance, pas un verdict ».
7. **Récupération** : HRV 7 j vs base (avec bande de référence), FC repos, sommeil, Training Readiness/Body Battery marqués « avis Garmin » ; aucun feu vert/rouge.
8. **Saisie du soir** : RPE (pour les séances du jour), courbatures, malade, note — validation en un tap.
9. **Note libre / lien** : bloc texte markdown simple.

Crée la page d'accueil par défaut contenant : programme, charge, dernières sorties, récupération, saisie du soir.

## Critères d'acceptation
Tests de composants (rendu avec données, vide, erreur), vérification visuelle desktop + mobile dans le navigateur, aucune valeur inventée quand les données manquent. Commit : `feat(widgets): widgets phase 1`.
