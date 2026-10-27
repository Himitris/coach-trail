# Déploiement — Coach Trail (phase 0)

Objectif : `https://coach.himitris.fr` accessible **uniquement via Tailscale**, certificat Let's Encrypt obtenu par défi DNS-01 (OVH), aucun port public.

Architecture : `caddy` (HTTPS, seul service publié, lié à l'IP Tailscale) → `api` (FastAPI, `/api/*`) et `web` (statique, le reste).

## 1. Préparer le conteneur / la VM Proxmox

Un LXC Debian 12 ou une VM Debian 12 suffit. Pour un LXC, activer `nesting` et `keyctl` (Options → Features) pour Docker, et donner accès à `/dev/net/tun` pour Tailscale.

### Docker
```bash
curl -fsSL https://get.docker.com | sh
docker compose version   # doit répondre (plugin compose v2)
```

### Tailscale
```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
tailscale ip -4          # noter l'IP 100.x.y.z
```
Dans la console d'admin Tailscale, désactiver l'expiration de clé pour cette machine.

## 2. Clés API OVH (droits limités à la zone)

1. Ouvrir https://eu.api.ovh.com/createToken/ (endpoint `ovh-eu`).
2. Renseigner un nom d'application, puis les droits **uniquement** :
   - `GET /domain/zone/himitris.fr/*`
   - `POST /domain/zone/himitris.fr/*`
   - `DELETE /domain/zone/himitris.fr/*`
3. Récupérer `Application Key`, `Application Secret`, `Consumer Key`.

## 3. Enregistrement DNS

Dans la zone `himitris.fr` : enregistrement **A** `coach` → IP Tailscale (`100.x.y.z`), TTL court (300 s).
L'IP 100.x n'est routable que dans le tailnet : le nom est public, le service ne l'est pas.

## 4. Configuration

```bash
git clone <dépôt> coach-trail && cd coach-trail/deploy
cp ../.env.example .env
chmod 600 .env
nano .env     # DOMAIN, TAILSCALE_IP, ACME_EMAIL, OVH_*
```
`.env` est ignoré par Git : ne jamais le commiter. Seules les variables `TZ`, `DOMAIN`, `TAILSCALE_IP`, `ACME_EMAIL` et `OVH_*` servent à cette étape.

## 5. Lancer

```bash
docker compose config -q      # valide la configuration
docker compose up -d --build  # le 1er build compile Caddy avec xcaddy (quelques minutes)
docker compose logs -f caddy  # attendre « certificate obtained successfully »
```

## 6. Vérifier

```bash
./check.sh
```
Le script contrôle que `https://coach.himitris.fr/api/ping` répond `{"ok":true}` et qu'aucun port 80/443 n'écoute sur `0.0.0.0` ni sur l'IP publique.

**Critère final** : depuis le téléphone, Tailscale activé, `https://coach.himitris.fr` affiche « Coach Trail — OK » en HTTPS valide ; Tailscale coupé (ou depuis un autre réseau), aucune réponse.

## Dépannage

- **Certificat non émis** : vérifier les droits de la clé OVH et l'heure du serveur (`timedatectl`). Les logs Caddy indiquent l'étape DNS en échec.
- **`coach.himitris.fr` ne se résout pas** (anti-rebind : box/routeur/résolveur qui filtre les noms publics pointant vers une IP privée/100.x) :
  - **Plan B — DNS partagé Tailscale** : console Tailscale → DNS → *Add nameserver* → *Custom*, avec un résolveur sans anti-rebind (ex. `1.1.1.1`) ; restreindre à *Restrict to domain* `himitris.fr`, ou activer *Override local DNS*. Alternative : *Split DNS* vers un petit résolveur local qui répond `coach.himitris.fr → 100.x.y.z`.
  - Dernier recours : entrée `100.x.y.z coach.himitris.fr` dans `/etc/hosts` des appareils (le certificat reste valide).
- **Le port ne se lie pas** : `TAILSCALE_IP` doit être l'IP réelle de l'hôte (`tailscale ip -4`) ; Tailscale doit être démarré avant Docker (`systemctl restart docker` sinon).
