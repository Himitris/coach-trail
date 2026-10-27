# Frontend — Coach Trail

React 18 + Vite + TypeScript strict + react-grid-layout + TanStack Query. Interface en français,
thème clair/sombre automatique, mobile first. L'UI ne lit que l'API locale (`/api/*`).

```bash
npm ci
npm run dev        # http://localhost:5173, /api proxifié vers 127.0.0.1:8000
npm run typecheck && npm run lint && npm test
npm run build      # dist/ (servi par Caddy, voir Dockerfile)
```

Backend de développement : `cd ../backend && uvicorn app.main:app_factory --factory --port 8000`.

## Structure

- `src/app` — coque (en-tête, barre d'onglets fixe, raccourcis 1–9), fournisseur de disposition.
- `src/layout` — modèle, **réducteur** pur (pages, widgets, dispositions par point de rupture),
  valeurs par défaut, et `LayoutSaver` (sauvegarde différée, révisions, conflits).
- `src/widgets` — registre, cadre commun (titre, réglages, export, suppression), états
  chargement / vide / erreur, widget « Note libre ».
- `src/pages` — tableau de bord, santé des sources, reconnexion Garmin. `src/api` — client typé.

## Disposition

Le document (pages, widgets, positions `lg` ordinateur / `md` tablette / `sm` téléphone,
réglages) est stocké par le serveur (`GET/PUT /api/layout`) : identique partout. Chaque point de
rupture a sa propre disposition ; seules les actions de l'utilisateur (glisser, redimensionner)
la modifient. Les sauvegardes sont groupées (800 ms) et portent un numéro de révision : si un
autre appareil a écrit entre-temps, la version du serveur est rechargée et un message le signale.

## Ajouter un widget

1. Créer `src/widgets/MonWidget.tsx` : composant + `registerWidget({ id, title, description,
   defaultSize, minSize, defaultSettings, settingsSchema, Component, exportData })`.
   Les réglages usuels (période, sport, métrique) sont dans `settingFields.ts` ; pour les données,
   utiliser `<WidgetData query=… />` (chargement / vide / erreur homogènes).
2. L'importer dans `src/widgets/index.ts`. Il apparaît dans le catalogue « + Widget ».

Le bouton d'export de chaque cadre appelle `exportData` ; `src/app/export.ts` copie pour l'instant
le Markdown du widget, le prompt 09 y branchera « Copier pour Claude ».
