# 07 — Frontend : tableau de bord modulaire

Lis `CLAUDE.md`. Crée l'interface dans `frontend/` : React 18 + Vite + TypeScript strict + react-grid-layout + TanStack Query. Thème sombre/clair automatique, mobile first, textes en français.

## À faire
1. Structure : `src/app`, `src/widgets` (registre), `src/api` (client typé), `src/pages`.
2. **Barre d'onglets fixe** : pages illimitées ; créer, renommer, dupliquer, réordonner, supprimer ; une page « accueil » désignée ; raccourcis clavier 1–9 ; un clic pour changer de page.
3. **Grille** : mode lecture (verrouillé) / mode édition (glisser-déposer, redimensionnement, suppression d'un cadre en un clic, bouton « + widget » ouvrant le catalogue). Dispositions **distinctes par point de rupture** (ordinateur / tablette / téléphone) avec bouton « réinitialiser la disposition par défaut ».
4. **Persistance côté serveur** : API backend `GET/PUT /api/layout` (pages, widgets, positions par breakpoint, réglages) stockée en base ; mises à jour avec debounce ; identique téléphone/PC. Ajoute la migration et les routes backend avec tests.
5. **Registre de widgets** : interface `WidgetDefinition` { id, titre, tailles min/défaut, composant, schéma de réglages (période, sport, métrique), `exportData()` }. Chaque cadre a une barre : titre, roue de réglages, bouton export (appelle `exportData`, branché au prompt 09). États chargement / vide / erreur homogènes ; un widget en erreur ne casse pas la page.
6. Un widget factice « Note libre » pour valider le mécanisme de bout en bout.
7. Page « Santé des sources » (route dédiée) lisant `/api/sources/health`, bouton « Synchroniser maintenant », badge « Garmin indisponible depuis le … » dans l'en-tête, écran de reconnexion Garmin (formulaire email/mot de passe/MFA vers `/api/garmin/login`).
8. Servi par Caddy en build statique (mettre à jour le service `web` du compose, image multi-stage).

## Critères d'acceptation
`tsc --noEmit`, lint, tests Vitest (reducer de layout, persistance, raccourcis) verts ; vérification manuelle dans le navigateur : ajout/déplacement/suppression de widgets, rechargement conserve la disposition, disposition téléphone différente de celle du PC. Commit : `feat(frontend): dashboard modulaire`.
