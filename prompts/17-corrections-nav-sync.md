# Prompt 17 — Corrections, raccourcis AZERTY, « Vérifier les nouveautés » (V2)

Lis `CLAUDE.md` et `docs/cahier-des-charges-v2.md` (§2.1 et §2.5). Périmètre strict.

## À faire
1. **Menu ⋯ des pages** (`frontend/src/app/TabBar.tsx`, `styles.css`) : le menu est rogné par `.tabs { overflow-x:auto; overflow-y:hidden }`. Le rendre via un portail (`createPortal`) positionné sous le bouton (position fixe calculée depuis `getBoundingClientRect`), fermeture sur clic extérieur / Échap. Test : le menu est dans `document.body`, « Supprimer » supprime la page après confirmation.
2. **Raccourcis** (`frontend/src/app/shortcuts.ts`) : en plus de `1`–`9`, mapper la rangée AZERTY `& é " ' ( - è _ ç à` (valeurs de `event.key`) sur les pages 1 à 10 ; garder le pavé numérique ; ignorer en saisie ou avec modificateur. Afficher la touche dans l'onglet. Tests unitaires de `pageIndexForKey`.
3. **Vérifier les nouveautés** :
   - Backend : `POST /sync/check` (202, 409 si synchro en cours). Pour Garmin (repli Intervals.icu comme aujourd'hui) : récupérer les activités depuis la date de la dernière activité en base moins 1 jour, ingérer toutes les nouvelles, ne pas toucher au bien-être ni aux flux sauf pour les activités nouvelles. Idempotent. Réutiliser `SyncService` (ajouter un mode `trigger="check"` plutôt qu'un second chemin).
   - Frontend : bouton « Vérifier les nouveautés » à côté de « Synchroniser maintenant » (Sources + en-tête si déjà présent), désactivé pendant une synchro, toast « 2 nouvelle(s) activité(s) » ou « Rien de nouveau ».
   - Tests pytest : 0, 1 et 3 activités de retard ; relance sans doublon ; échec Garmin → repli.

## Fin
Ruff, mypy/tsc, pytest et vitest verts ; un commit `feat(v2): menu pages, raccourcis AZERTY, vérification rapide des activités`.
