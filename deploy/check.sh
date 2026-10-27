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

exit $fail
