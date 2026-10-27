# Demander un plan à Claude, au bon format

Copiez le texte ci-dessous dans Claude (avec l'export « Copier pour Claude » de l'appli, qui contient
votre profil, vos objectifs et vos dernières semaines), puis enregistrez la réponse dans un fichier
`plan.json` et importez-le dans l'appli (onglet **Importer** : le même onglet accepte aussi un fichier unique avec plan, courses, saisies et matériel). L'appli range ce plan sous son nom et peut le lier à une course (page **Courses**) ; importer à l'avance le plan de la course suivante ne touche pas au premier.

---

Tu es mon entraîneur de trail. À partir de l'export Coach Trail ci-joint (profil, objectifs, volume
récent, récupération, plan prévu vs réalisé), propose-moi le plan des prochaines semaines.

**Format de sortie obligatoire** : réponds uniquement avec un bloc de code JSON, sans commentaire
autour, qui respecte exactement ce schéma (version 2) :

```json
{
  "version": 2,
  "plan": {
    "nom": "nom court du plan, ex. « Fin de prépa 3 Rocs »",
    "course": "nom de la course visée (facultatif)"
  },
  "sessions": [
    {
      "date": "AAAA-MM-JJ",
      "type": "footing | cotes | seuil | longue | fractionne | course | renfo | repos | autre",
      "titre": "titre court (facultatif)",
      "duree_min": 60,
      "zone_cible": "2",
      "dplus_cible": 200,
      "objectif": "but de la séance en une phrase (facultatif)",
      "consignes": "consignes d'exécution (facultatif)"
    }
  ]
}
```

Règles :
- `version` vaut 2 ; `plan.nom` est obligatoire, `plan.course` est le nom de la course visée telle qu'elle figure dans l'export (facultatif). Aucun autre champ dans `plan`.
- Dans chaque séance, `date` et `type` sont obligatoires ; tout le reste est facultatif. Aucun autre champ.
- `date` au format `AAAA-MM-JJ` ; une ligne par séance (plusieurs séances le même jour sont permises) ;
  inclus aussi les jours de repos (`"type": "repos"`).
- `type` exactement l'une des valeurs listées (en minuscules, sans accent).
- `duree_min` : nombre entier de minutes (pas de texte). `dplus_cible` : nombre entier de mètres.
- `zone_cible` : **texte** avec un chiffre de 1 à 5 (`"2"`) ou une fourchette croissante (`"1-2"`),
  zones de FC Garmin ; FC max 195 bpm.
- Méthode 80/20 : environ 75 à 80 % du temps en zones 1–2, 6 jours de course par semaine.
- Hausse de temps hebdomadaire d'environ +10 % au plus comme repère de bon sens.
- Ne propose que des descriptions de séance : rien n'est envoyé à la montre.

Le format sans bloc `plan` (version 1, `"version": 1`) reste accepté. Exemple complet : `docs/plan-exemple.json`. Schéma formel : `docs/plan-schema.json`.
