#!/usr/bin/env bash
# Restaure la base depuis une sauvegarde de BACKUP_DIR.
#   ./restore.sh                      # liste les sauvegardes disponibles
#   ./restore.sh daily/coach-2026-10-15.db   # chemin relatif à BACKUP_HOST_DIR (ou absolu dessous)
# Arrête l'API, vérifie la sauvegarde (PRAGMA integrity_check), garde l'ancienne base à côté
# (« coach.db.avant-restauration-… »), remplace la base, redémarre l'API et contrôle /api/health.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
: "${BACKUP_HOST_DIR:?BACKUP_HOST_DIR manquant dans .env}"
COMPOSE=(docker compose)

if [ $# -eq 0 ]; then
  echo "Sauvegardes disponibles dans $BACKUP_HOST_DIR :"
  (cd "$BACKUP_HOST_DIR" && ls -1 daily/*.db weekly/*.db monthly/*.db 2>/dev/null) || echo "  (aucune)"
  echo
  echo "Usage : $0 <fichier>   ex. $0 daily/$(date +%Y-%m-%d | sed 's/^/coach-/').db"
  exit 2
fi

file="$1"
case "$file" in
  "$BACKUP_HOST_DIR"/*) file="${file#"$BACKUP_HOST_DIR"/}" ;;
  /*) echo "Le fichier doit se trouver sous $BACKUP_HOST_DIR" >&2; exit 2 ;;
esac
[ -f "$BACKUP_HOST_DIR/$file" ] || { echo "Introuvable : $BACKUP_HOST_DIR/$file" >&2; exit 2; }

echo "== Restauration de $file (l'API sera arrêtée quelques secondes)"
if [ "${ASSUME_YES:-}" != "1" ]; then
  read -r -p "La base actuelle sera conservée à côté. Continuer ? [o/N] " answer
  [ "$answer" = "o" ] || { echo "Annulé."; exit 1; }
fi

"${COMPOSE[@]}" stop api
trap '"${COMPOSE[@]}" start api >/dev/null 2>&1 || true' EXIT   # l'API redémarre même en cas d'échec
"${COMPOSE[@]}" run --rm --no-deps api python -m app.cli restore "/backup/$file"
trap - EXIT
"${COMPOSE[@]}" up -d api

echo "== Contrôle"
for _ in $(seq 1 20); do
  if "${COMPOSE[@]}" exec -T api python -c \
    "import urllib.request,sys; sys.exit(0 if b'\"db\":\"ok\"' in urllib.request.urlopen('http://localhost:8000/api/health', timeout=3).read() else 1)" \
    >/dev/null 2>&1; then
    echo "OK : l'API répond et la base est saine."
    exit 0
  fi
  sleep 2
done
echo "ÉCHEC : l'API ne répond pas après la restauration (docker compose logs api)." >&2
exit 1
