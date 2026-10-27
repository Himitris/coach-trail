#!/usr/bin/env bash
# Vérifie le déploiement : ping HTTPS + absence d'écoute sur l'IP publique.
set -u
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
DOMAIN="${DOMAIN:-coach.himitris.fr}"
fail=0

echo "== 1. https://$DOMAIN/api/ping"
if out=$(curl -fsS --max-time 10 "https://$DOMAIN/api/ping") && echo "$out" | grep -q '"ok":true'; then
  echo "OK : $out"
else
  echo "ÉCHEC : pas de réponse valide (Tailscale actif ? DNS ? certificat ?)"; fail=1
fi

echo "== 2. Écoute des ports 80/443"
listeners=$(ss -H -ltn 2>/dev/null | awk '{print $4}' | grep -E ':(80|443)$' || true)
bad=$(echo "$listeners" | grep -E '^(0\.0\.0\.0|\*|\[::\]|::):' || true)
if [ -n "$bad" ]; then
  echo "ÉCHEC : écoute sur toutes les interfaces :"; echo "$bad"; fail=1
else
  echo "OK : aucune écoute sur 0.0.0.0 / ::"
  [ -n "$listeners" ] && echo "$listeners" | sed 's/^/  /'
fi

if pub=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null) && [ -n "$pub" ]; then
  if curl -sk --max-time 5 -o /dev/null "https://$pub/api/ping"; then
    echo "ÉCHEC : $pub répond sur 443 depuis cette machine"; fail=1
  else
    echo "OK : l'IP publique $pub ne répond pas sur 443"
  fi
fi

echo "== 3. En-têtes de sécurité"
headers=$(curl -fsSI --max-time 10 "https://$DOMAIN/" 2>/dev/null || true)
for h in strict-transport-security x-content-type-options x-frame-options content-security-policy referrer-policy; do
  if echo "$headers" | grep -qi "^$h:"; then echo "OK : $h"; else echo "ÉCHEC : en-tête $h absent"; fail=1; fi
done
if echo "$headers" | grep -qi "^access-control-allow-origin:"; then
  echo "ÉCHEC : CORS ouvert (access-control-allow-origin présent)"; fail=1
fi

echo "== 4. Secrets dans les journaux et droits des jetons"
leaks=0
for var in INTERVALS_API_KEY STRAVA_CLIENT_SECRET OVH_APPLICATION_SECRET OVH_CONSUMER_KEY; do
  value="${!var:-}"
  [ -n "$value" ] || continue
  if docker compose logs --no-color 2>&1 | grep -qF -- "$value"; then
    echo "ÉCHEC : la valeur de $var apparaît dans les journaux"; leaks=1
  fi
done
[ "$leaks" = 0 ] && echo "OK : aucun secret connu dans les journaux" || fail=1
if modes=$(docker compose exec -T api sh -c 'stat -c "%a %n" /data/garmin_tokens /data/garmin_tokens/* 2>/dev/null' | tr -d '\r') && [ -n "$modes" ]; then
  # dossier en 700, fichiers en 600 : rien pour le groupe ni les autres
  if echo "$modes" | awk '{ if ($1 !~ /^[0-7]00$/) bad=1 } END { exit bad }'; then
    echo "OK : jetons Garmin lisibles par leur propriétaire seulement"
  else
    echo "ÉCHEC : droits trop larges sur les jetons Garmin :"; echo "$modes"; fail=1
  fi
else
  echo "-- jetons Garmin absents (connexion pas encore faite)"
fi

echo "== 5. Sauvegarde"
if status=$(docker compose exec -T api python -c "import urllib.request;print(urllib.request.urlopen('http://localhost:8000/api/backup/status',timeout=5).read().decode())" 2>/dev/null); then
  if echo "$status" | grep -q '"ok":true'; then echo "OK : dernière sauvegarde réussie"
  else echo "ATTENTION : aucune sauvegarde réussie pour l'instant ($status)"; fi
fi

exit $fail
