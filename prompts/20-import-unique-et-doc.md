# Prompt 20 — Import unique et documentation visuelle (V2)

Lis `CLAUDE.md` et `docs/Cahier des charges – Coach Trail.docx` (section 10, V2). Prérequis : 19 terminé.

## À faire
1. **Import unique** : remplacer l'onglet « Plan » et la page `PlanImportPage` par un bouton **Importer** dans l'en-tête (dialogue ou page `/importer`) : zone « coller le texte » + dépôt de fichier. Détection du contenu par clés racine (`plan`/`sessions`, `courses`, `materiel`, `saisies`, `semaine_type`, `note`) via un moteur unique côté frontend (`frontend/src/imports/`) qui s'appuie sur les `ImportSpec` existantes — un document peut contenir plusieurs sections ; aperçu par section, case à cocher pour chacune, une seule confirmation. Formats V1 conservés. Les boutons d'import des widgets appellent le même moteur. Erreurs en français, rien d'écrit avant confirmation.
2. **Un seul prompt d'import** pour le coach, assemblé à partir des specs, affiché dans le dialogue avec un bouton « Copier » (fallback si presse-papiers indisponible, existant).
3. **Doc visuelle** (`DocsPage`) : une carte par widget avec **aperçu réel** (le composant du widget rendu avec des données d'exemple, via `fixtures`/mock de requêtes, non cliquable) ; clic → modale avec aperçu agrandi, réglages, export, import, exemple JSON, bouton « Copier cette fiche ». Bouton en tête de page **« Copier la doc pour mon agent »** : un Markdown unique (principe, widgets, formats d'import, exemples, prompt d'import), généré, testé (contient chaque widget et chaque spec).
4. **Simplification de la barre** : à droite uniquement Courses, Calendrier, Importer, Doc, Sources ; vérifier qu'aucun lien orphelin ne reste (`/plan/import` redirige vers l'import).
5. Mettre à jour `README.md`, `docs/export.md` si concernés, et `prompts/00-INDEX.md` (lignes 17–20, phase « V2 »).

## Fin
Tous les tests verts (backend + frontend), recette du §4 du cahier V2 déroulée à la main sur les points 1, 2, 6 ; un commit `feat(v2): import unique, doc visuelle`.
