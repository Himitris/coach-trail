# 10 — Sauvegardes et recette du MVP

Lis `CLAUDE.md`. Finalise la phase 1.

## À faire
1. **Sauvegarde quotidienne** : service/cron dans le compose (ou tâche planifiée de l'app) qui copie la base (`sqlite3 .backup`, jamais une copie brute du fichier en cours d'écriture) et les JSON bruts vers `BACKUP_DIR` (disque physiquement distinct), avec rotation (7 quotidiennes, 4 hebdomadaires, 6 mensuelles) et vérification d'intégrité (`PRAGMA integrity_check`).
2. **Script de restauration** `deploy/restore.sh` + procédure documentée ; test de restauration automatisé sur une copie temporaire.
3. Statut des sauvegardes visible dans la page « Santé des sources » (dernière sauvegarde, taille, résultat).
4. **Tests de bout en bout** (Playwright ou équivalent) avec backend + `FakeConnector` : ouvrir l'accueil → voir semaine, charge, dernières sorties, récupération ; lancer deux fois la sync → aucun doublon ; saisie du soir ; export Markdown en deux clics.
5. **Revue sécurité** : grep des logs pour secrets, droits des fichiers de jetons, aucun port exposé hors IP Tailscale, en-têtes de sécurité Caddy, CORS fermé.
6. Checklist de recette MVP dans `docs/recette-phase1.md` reprenant les critères du cahier des charges (phase 1) avec case à cocher et commande/URL de vérification pour chacun.
7. Mettre à jour `README.md` (installation, mise à jour, sauvegarde/restauration).

## Critères d'acceptation
Tous les tests verts ; restauration testée ; checklist rédigée. Commit : `feat: sauvegardes et recette MVP (fin phase 1)`.
