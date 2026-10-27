# Coach Trail — cahier des charges V2 (addendum)

Complète `Cahier des charges – Coach Trail.docx` (V1, toujours valable pour tout ce qui n'est pas listé ici). Stack, sources, règles métriques et sécurité inchangées (voir `CLAUDE.md`).

## 1. Intention de la V2

Coach Trail est un **carnet de bord visuel** de l'entraînement. Le coach (projet Claude) décide ; l'appli **garde et affiche** ce qu'il a dit, pour ne plus fouiller les conversations. Trois besoins :

1. **Retrouver le plan** : importer le plan validé une fois, le revoir 2–3 semaines plus tard sans rien chercher.
2. **Importer sans friction** : coller la réponse de Claude, vérifier, valider. Un seul geste, pas de formats à choisir.
3. **Alimenter le coach** : exporter à la demande ce dont il a besoin (inchangé).

Principe : *simple d'abord*. Tout ce qui complique l'import ou la navigation sans servir ces trois besoins est retiré ou regroupé.

## 2. Changements

### 2.1 Navigation et pages
- Pages utilisateur (widgets déplaçables) : conservées. Raccourcis **1–9 du pavé numérique ET touches `& é " ' ( - è _ ç à`** (rangée AZERTY du haut, sans Maj) = pages 1 à 10. Ces touches ne s'activent pas pendant une saisie.
- Deux pages **intégrées**, fixes, non supprimables : **Courses** et **Calendrier**.
- L'onglet « + Course » et l'onglet « Plan » disparaissent. Reste à droite : **Importer**, **Doc**, **Sources**.
- Correctif : le menu ⋯ d'une page (renommer, dupliquer, accueil, déplacer, supprimer) est **rogné** par la barre d'onglets (`overflow` sur `.tabs`, menu positionné en absolu à l'intérieur). Le rendre hors du conteneur (portail) et ajouter un test.

### 2.2 Courses et plans
- **Plan** = objet nommé : `nom`, `date_debut`, `date_fin`, `course` (objectif lié, facultatif), séances rattachées (`planned_session.plan_id`).
- Page **Courses** : liste des courses (existant `goal`) avec date, distance, D+, compte à rebours, profil altimétrique, et **le plan attribué** (ou « aucun plan »). Attribuer / détacher un plan en un clic. On peut importer à l'avance le plan de la course suivante : ses séances futures **n'écrasent jamais** un autre plan (les chevauchements sont signalés à l'aperçu).
- Migration : les séances existantes sont rattachées à un plan « Plan importé » créé automatiquement.

### 2.3 Calendrier
- Vue **semaine** (défaut) et **mois**, navigation précédent / suivant / aujourd'hui (le backend accepte déjà `?date=`).
- Chaque jour : séance prévue (couleur par plan), activité réalisée, statut prévu/réalisé (existant). Clic = détail de la séance (consignes, objectif).
- Le widget « Semaine » reçoit aussi les flèches semaine précédente/suivante.

### 2.4 Import unique
- Un seul bouton **Importer** (en-tête). On colle le texte de Claude ou on dépose un fichier.
- Détection automatique du contenu : un document peut mêler **plan**, courses, matériel, saisies, notes (`{"version": 2, "plan": {...}, "courses": [...], ...}`). Les formats V1 restent acceptés.
- Aperçu obligatoire (rien n'est écrit), erreurs en français, puis confirmation. Les boutons d'import par widget restent, mais appellent le même moteur.
- **Un seul prompt** « format d'import » à donner au coach, copiable en un clic (au lieu d'un par widget).

### 2.5 Synchronisation Garmin
- Nocturne : inchangé.
- Nouveau bouton **« Vérifier les nouveautés »** (en plus de « Synchroniser maintenant ») : interroge Garmin seulement pour les activités **plus récentes que la dernière en base**, les récupère toutes (1, 2, 3 de retard…) et s'arrête à la première déjà connue. Pas de rechargement d'historique. Repli Intervals.icu et dédup inchangés ; bouton grisé pendant une synchro.

### 2.6 Documentation visuelle
- Chaque widget : **fiche avec aperçu visuel** (rendu réel avec données d'exemple) ouverte dans une fenêtre modale, plus ses réglages, son export et son import.
- Bouton **« Copier la doc pour mon agent »** : toute la doc (widgets, formats d'import, exemples, prompt d'import) en un seul Markdown propre, pour le coller à un agent qui prépare des imports multiples.
- Bouton « Copier » par fiche.

## 3. Hors périmètre
Nouveaux widgets, nouvelles sources, score maison, alertes blessure (règles V1 inchangées).

## 4. Critères de recette
1. Coller un plan de 3 semaines → aperçu → valider → il apparaît dans le calendrier et sur la page Courses, rattaché à la course.
2. Importer ensuite le plan suivant (après la course) sans toucher au premier.
3. Naviguer de semaine en semaine et de mois en mois sans rechargement.
4. Touches `&`, `é`, `"`… changent de page ; le menu ⋯ s'affiche entier et supprime une page.
5. « Vérifier les nouveautés » ramène 2–3 activités manquantes sans resynchroniser l'historique.
6. La Doc montre l'aperçu d'un widget et « Copier la doc » produit un Markdown complet.
