# Recette du MVP (phase 1)

Checklist de mise en service, tirée du cahier des charges (sections 4 à 9, phase 1). Cocher chaque
ligne après avoir exécuté la vérification indiquée. Les commandes `docker compose …` se lancent
depuis `deploy/` ; `BASE` désigne `https://coach.himitris.fr` (depuis un appareil du tailnet).

```bash
BASE=https://coach.himitris.fr
```

## 0. Tests automatiques (poste de développement)

- [ ] Backend : `cd backend && ruff check . && ruff format --check . && mypy && pytest` (tests verts, dont sauvegardes, restauration et sécurité)
- [ ] Frontend : `cd frontend && npm run lint && npm run typecheck && npm test`
- [ ] Bout en bout (vrai backend + `FakeConnector` + frontend construit) : `cd frontend && npm run e2e`
      couvre : accueil complet, synchronisation relancée deux fois sans doublon, saisie du soir, export en deux clics.
      Navigateur déjà installé ailleurs : `PW_CHROMIUM=/chemin/chromium npm run e2e` ; sinon `npx playwright install chromium` une fois.

## 1. Socle et réseau (phase 0)

- [ ] `https://coach.himitris.fr` s'ouvre en HTTPS valide depuis le téléphone, Tailscale actif.
- [ ] Tailscale coupé : aucune réponse. → `./check.sh` (étapes 1 et 2 : ping, ports 80/443 non écoutés sur 0.0.0.0 ni sur l'IP publique)
- [ ] Redémarrage automatique : `docker compose kill api && sleep 15 && curl -fsS $BASE/api/health` répond `"db":"ok"` (politique `restart: unless-stopped`)
- [ ] Schéma versionné : `docker compose exec api alembic current` affiche la dernière révision (`alembic/versions`).

## 2. Synchronisation (cahier des charges §3 et phase 1)

- [ ] Connexion Garmin unique avec MFA : `docker compose exec api python -m app.cli garmin-login` (ou écran de reconnexion de `/sources`).
- [ ] « Synchroniser maintenant » (`/sources`) : état « À jour », date de dernière synchronisation renseignée.
- [ ] Activités et flux : `curl -s "$BASE/api/activities?limit=3"` renvoie des sorties ; `curl -s $BASE/api/activities/<id>` contient `stream` et `zones`.
- [ ] HRV, sommeil, FC repos, Training Readiness, Body Battery : `curl -s "$BASE/api/metrics/wellness?days=14"` — les jours reçus ont des valeurs, les jours manquants sont absents (rien d'inventé).
- [ ] **Aucun doublon** : noter `curl -s "$BASE/api/activities?limit=200" | jq length`, relancer deux fois « Synchroniser maintenant », le nombre est identique.
- [ ] Stockage en deux couches : `docker compose exec api python -c "import sqlite3;c=sqlite3.connect('/data/coach.db');print(c.execute('select type,count(*) from raw_payload group by type').fetchall())"` liste `activity`, `activity_stream`, `wellness`.
- [ ] Synchronisation nocturne planifiée : `curl -s $BASE/api/sync/status` donne `nightly_time` (03:30 par défaut) et `next_run_at`.
- [ ] Garmin en panne : badge « Garmin indisponible depuis le … » dans l'en-tête et sur `/sources`, dernières valeurs conservées, aucune erreur bloquante.

## 3. Tableau de bord (§5)

- [ ] L'accueil montre en une page : programme de la semaine, charge de la semaine, dernières sorties, récupération, saisie du soir.
- [ ] Mode édition : déplacer et redimensionner un cadre, « + Widget » ouvre le catalogue, supprimer un cadre ; mode lecture verrouillé.
- [ ] Plusieurs pages : créer, renommer, dupliquer, réordonner ; raccourcis clavier 1 à 9 ; une page d'accueil désignée.
- [ ] Disposition par taille d'écran (ordinateur / tablette / téléphone) et bouton « Réinitialiser la disposition ».
- [ ] La disposition est identique sur téléphone et ordinateur : `curl -s $BASE/api/layout | jq .revision`, modifier sur un appareil, relire sur l'autre.
- [ ] Widgets de phase 1 présents dans le catalogue : Programme de la semaine, Charge de la semaine, Dernières sorties, Détail de séance, Répartition des intensités, Forme (CTL/ATL/TSB), Récupération, Saisie du soir (+ Note libre).
- [ ] Chaque widget a ses réglages (⚙) et un bouton d'export (⤓).

## 4. Règles métriques (CLAUDE.md, §4)

- [ ] Aucun score de forme unique : chaque composante est affichée séparément avec son niveau de preuve.
- [ ] ACWR (valeur Garmin) : affiché en gris avec la mention « non validé » (widget Récupération et export), sans seuil, zone verte ni alerte.
- [ ] HRV : moyenne 7 j vs base 30–60 j, tendance, pas de feu vert/rouge quotidien (`curl -s "$BASE/api/metrics/recovery?days=60" | jq .hrv`).
- [ ] Hausse hebdomadaire de temps : repère « +10 % » jamais présenté comme prédicteur de blessure (widget Charge de la semaine).
- [ ] Intensités : zones 1–2 = « bas d'intensité », cible 75–80 %, courses exclues (`curl -s $BASE/api/metrics/intensity`).
- [ ] CTL/ATL/TSB : constantes 42/7 j, courbe de tendance, avertissements si profil ancien ou historique court (`/api/metrics/fitness`).
- [ ] Training Readiness / Body Battery : étiquetés « avis Garmin, non validé ».
- [ ] Course du jour : la FC de compétition n'est pas comparée aux séances (pas de temps par zone sur une course).

## 5. Saisie et programme (§4 et §5)

- [ ] Saisie du soir en quelques secondes : RPE de la séance, courbatures, malade, note ; enregistrée aussitôt, toujours là après rechargement.
- [ ] Programme de la semaine : `docker compose exec api python -m app.cli seed-demo` (si semaine vide), statut fait / manqué / partiel, réalisé affiché à côté.

## 6. Export vers Claude (§6)

- [ ] Depuis l'accueil, **deux clics** : « Copier pour Claude » puis « Copier » → toast « Export copié pour Claude », presse-papiers rempli.
- [ ] Le Markdown contient : profil et objectifs avec jours restants, volume, intensités réalisé/cible, séances, plan prévu vs réalisé, récupération, saisies et notes, glossaire avec niveaux de preuve, limites et sources (`curl -s "$BASE/api/export?from=2026-10-01&to=2026-10-28" | wc -w` : quelques milliers de mots au plus).
- [ ] Période : 7 jours, 4 semaines, 12 semaines et plage libre fonctionnent.
- [ ] JSON complet téléchargeable et fichier de flux sous-échantillonnés (un point toutes les 45 s) : liens dans la fenêtre d'export.
- [ ] Export par widget (⤓ du cadre) et par séance (⤓ de la ligne ou du détail).
- [ ] Rien n'est envoyé automatiquement : aucune requête sortante lors d'un export.

## 7. Sécurité (§8)

Automatisé dans `backend/tests/test_security.py` et `./check.sh` (étapes 3 et 4) ; à confirmer sur le serveur :

- [ ] Seul Caddy publie des ports, liés à l'IP Tailscale : `docker compose ps --format '{{.Name}} {{.Ports}}'` et `./check.sh`.
- [ ] En-têtes de sécurité (HSTS, CSP stricte sans origine externe, nosniff, DENY, Referrer-Policy, Permissions-Policy) : `curl -sI $BASE/ | grep -iE 'strict|content-security|x-frame|x-content|referrer|permissions'`.
- [ ] CORS fermé : `curl -si -X OPTIONS $BASE/api/health -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET'` ne renvoie aucun `access-control-*`.
- [ ] Aucun secret dans les journaux : `./check.sh` (étape 4) et `docker compose logs api | grep -iE 'password|api_key|secret'` ne montre que des valeurs masquées.
- [ ] Jetons Garmin en 600 dans un dossier 700 : `docker compose exec api stat -c '%a %n' /data/garmin_tokens /data/garmin_tokens/*`.
- [ ] Mot de passe Garmin non conservé : absent de `deploy/.env`, des journaux et de `/data`.
- [ ] `deploy/.env` en 600 et jamais dans Git : `git ls-files | grep -c '\.env$'` vaut 0.
- [ ] ACL Tailscale limitées à vos appareils (console d'admin Tailscale).

## 8. Sauvegardes (§8) — **avant la mise en service**

- [ ] `BACKUP_HOST_DIR` pointe vers un disque physiquement distinct de `data/` (`df data $BACKUP_HOST_DIR` : deux périphériques différents ; pas d'avertissement « même volume » sur `/sources`).
- [ ] Sauvegarde immédiate : `docker compose exec api python -m app.cli backup` → « Sauvegarde réussie ».
- [ ] La page `/sources` (carte « Sauvegardes ») affiche la date, la taille, « Contrôle d'intégrité : réussi » et les copies conservées.
- [ ] Planification : `BACKUP_TIME` (04:30 par défaut), après la synchronisation nocturne ; le lendemain, un nouveau fichier `daily/coach-AAAA-MM-JJ.db` existe.
- [ ] Rotation : jamais plus de 7 quotidiennes, 4 hebdomadaires, 6 mensuelles (`ls $BACKUP_HOST_DIR/{daily,weekly,monthly}`).
- [ ] **Test de restauration** (sur la vraie installation, avec confirmation) : `./restore.sh daily/coach-AAAA-MM-JJ.db` → « OK : l'API répond et la base est saine » ; les données sont celles de la sauvegarde ; l'ancienne base est conservée en `coach.db.avant-restauration-…`.
- [ ] Test de restauration sur copie temporaire (sans toucher à la production) : `python -m pytest backend/tests/test_backup.py -k temporary_copy`.
- [ ] La copie hors machine du dossier de sauvegarde est vérifiée au moins une fois (le disque distinct est celui d'un autre appareil, pas une partition du même disque).

## 9. Décision

- [ ] Toutes les cases ci-dessus sont cochées → mise en service de la phase 1.
- [ ] Sinon, noter ici les écarts et leur échéance :
