# Déploiement — KORVA OS

Couvre les images Docker de production, les manifestes de déploiement, l'intégration continue et les variables d'environnement.

**Aucun hébergement n'est provisionné à ce jour.** Les manifestes ci-dessous (`docker-compose.prod.yml`, `docker/caddy/Caddyfile`, `.env.production.example`) sont prêts à l'emploi mais n'ont jamais été exécutés contre une vraie infrastructure — ils ont été écrits à partir des Dockerfiles et du code réels, pas copiés d'un modèle. Traiter la première exécution comme une première exécution : voir le runbook en §Runbook, qui est séquencé pour échouer tôt et bruyamment plutôt que tard et silencieusement.

## Images Docker

Trois images de production, une par app front-facing (`apps/worker` n'a pas d'image : c'est un squelette de Phase 1 jamais réellement câblé, voir `docs/architecture-decisions.md` ADR-005 — le traitement asynchrone réel vit dans `apps/api`).

```
apps/api/Dockerfile          → API NestJS (port 4000)
apps/web/Dockerfile          → Dashboard Next.js (port 3000)
apps/storefront/Dockerfile   → Storefront Next.js (port 3000)
```

Le contexte de build est **toujours la racine du monorepo** (pas le dossier de l'app) — chaque Dockerfile a besoin des manifests des autres packages du workspace pnpm pour résoudre les dépendances `workspace:*` :

```bash
docker build -f apps/api/Dockerfile -t korva-api .
docker build -f apps/web/Dockerfile -t korva-web .
docker build -f apps/storefront/Dockerfile -t korva-storefront .
```

Les trois images ont été construites et démarrées manuellement pendant cette phase (API contre un vrai MongoDB/Redis, web et storefront en `NODE_ENV=production`) pour vérifier qu'elles bootent et répondent réellement — pas seulement qu'elles compilent.

**Pourquoi pas `output: "standalone"` pour web/storefront** : le traceur de fichiers de Next.js a un trou connu avec les symlinks pnpm sur `@swc/helpers` (`MODULE_NOT_FOUND` sur `@swc/helpers/esm/_interop_require_default.js` au démarrage, reproduit pendant cette phase). Les deux Dockerfiles copient `node_modules` en entier depuis l'étage de build et lancent `next start` directement via le binaire (`node_modules/.bin/next start`, pas `pnpm exec next start` qui échoue en runtime car le `node_modules` copié ne contient pas la structure complète du workspace nécessaire à la vérification `pnpm exec`) — image plus grosse, mais sans ce piège.

`packages/types`/`packages/validation`/`packages/ui` n'ont pas d'étape de build ([ADR-001](architecture-decisions.md#adr-001)) : leur `package.json` pointe `main`/`types` directement sur `src/*.ts`. Chaque image de runtime copie donc ces packages en source, pas juste leur `node_modules` — le JS compilé (`dist/main.js` pour l'API, le serveur Next.js pour web/storefront) continue de les résoudre via l'exécution native de TypeScript par Node au runtime.

## Temps et fiabilité du build d'image

Un build d'image à froid n'a aucun cache de store pnpm : il télécharge chaque tarball, et pnpm 11 vérifie en plus les politiques de chaîne d'approvisionnement du lockfile (~1200 entrées, **4 à 5 minutes** à elles seules, mesuré). Comptez une quinzaine de minutes par image sur une connexion ordinaire, bien plus sur une connexion lente.

Les trois Dockerfiles passent `--fetch-timeout 120000` à `pnpm install`, au lieu des 60 s par défaut. Ce n'est pas du confort : sur une connexion lente ou saturée, le défaut interrompt l'installation entière avec `TimeoutError: The operation was aborted due to timeout`, ce qui ressemble à un Dockerfile cassé sans en être un. Vérifié en reproduisant l'étape dans `node:26-slim` — la même installation aboutit dès que le timeout est relevé, scripts natifs compris (`argon2`, `msgpackr-extract` utilisent leurs prébuilds `linux-x64`, aucun compilateur n'est requis).

## Variables d'environnement de build

`apps/web`/`apps/storefront` ont besoin de `NEXT_PUBLIC_API_URL` **au moment du build** (Next.js inline les variables `NEXT_PUBLIC_*` dans le bundle client, pas au runtime) :

```bash
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.example.com/api/v1 -t korva-web .
```

## Variables d'environnement de runtime (API)

Voir `.env.production.example` pour un modèle commenté, et `.env.example` pour la liste exhaustive.

Obligatoires — `validateEnv` (`apps/api/src/core/config/env.validation.ts`) refuse de démarrer sans elles, **six** et non quatre :

```
MONGODB_URI  REDIS_URL  JWT_SECRET  JWT_REFRESH_SECRET
CUSTOMER_JWT_SECRET  INTEGRATION_CREDENTIALS_KEY
```

Toutes les autres (`CORS_ORIGINS`, clés de fournisseurs externes...) ont un comportement de repli sûr — ce qui signifie en pratique que la fonctionnalité concernée est inerte, pas cassée. Voir [security.md](security.md).

## Health checks et métriques

```
GET /api/v1/health            (liveness générique)
GET /api/v1/health/database
GET /api/v1/health/redis
GET /api/v1/health/queues     (compteurs BullMQ agrégés, les 12 files)
GET /api/v1/metrics           (format d'exposition Prometheus 0.0.4)
```

Toutes sont `@Public()` : un sonde de liveness ou un scraper Prometheus ne peut pas présenter de JWT de locataire. Aucune n'expose de donnée de locataire — uniquement des compteurs agrégés et des chiffres de process. `/metrics` accepte en plus un `Authorization: Bearer <METRICS_TOKEN>` si la variable est définie, et le Caddyfile la bloque en bordure par défaut.

## Intégration continue

`.github/workflows/ci.yml` — sur chaque push vers `main` et chaque pull request : `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r build`, tests unitaires et e2e de `apps/api` (MongoDB 7 + Redis 7 démarrés comme services du job, mêmes identifiants que `docker-compose.yml`). Reproduit exactement la séquence de vérification suivie manuellement à la fin de chaque phase de ce projet (voir Definition of Done, `docs/IMPLEMENTATION_PLAN.md`).

**Non vérifié par exécution réelle** (pas d'accès à GitHub Actions depuis cet environnement) — le workflow a été relu attentivement et reproduit exactement les commandes validées manuellement des dizaines de fois pendant ce projet, mais sa toute première exécution sur GitHub doit être surveillée.

## Manifestes de déploiement

| Fichier | Rôle |
|---|---|
| `docker-compose.prod.yml` | Les 3 images applicatives + Caddy. **Ne contient aucune base de données** : voir ci-dessous. |
| `docker/caddy/Caddyfile` | Terminaison TLS, routage par hostname, TLS à la demande pour les domaines personnalisés des locataires. |
| `.env.production.example` | Modèle à copier en `.env.production` (gitignoré). |

**Pourquoi aucune base de données dans le compose de production.** `docker-compose.yml` (développement) démarre MongoDB et Redis en conteneurs ; le compose de production ne le fait délibérément pas. Faire tourner le datastore primaire d'un SaaS multi-locataire en conteneur voisin, sans sauvegardes gérées, sans restauration à un instant T et sans bascule, tient jusqu'au jour où ça ne tient plus. `MONGODB_URI` doit pointer vers un **replica set géré** — obligatoire, pas préférable : les écritures financières utilisent des transactions multi-documents, que MongoDB ne supporte que sur un replica set. Un mongod autonome démarrera, servira les lectures, puis échouera sur chaque écriture financière.

**TLS pour les domaines personnalisés.** Les locataires ajoutent leur domaine *à l'exécution*, donc aucun fichier de configuration ne peut les lister au démarrage. Caddy utilise son TLS à la demande, avec un garde-fou : avant d'émettre un certificat, il appelle `GET /api/v1/public-sites/domain-allowed?domain=<host>`, qui répond 204 uniquement pour un domaine réellement rattaché à une organisation dont le module `website` est actif, et 404 sinon. Sans ce garde-fou, n'importe qui pourrait faire pointer un enregistrement DNS vers cet hôte et faire demander un certificat en son nom, épuisant le quota ACME de tout le déploiement en quelques minutes. Cette route est bloquée en bordure (Caddyfile) : elle ne doit être joignable que depuis le réseau interne, sinon un appelant externe pourrait énumérer les domaines configurés, une requête à la fois.

## Modèle de coût Redis — à lire avant de choisir un hébergeur

BullMQ est conçu en supposant que **les commandes Redis sont gratuites**, et cette application en fait un usage intensif au repos. Une instance d'API ouvre en permanence :

- **13 `Worker`** — chacun réémet un `bzpopmin` bloquant toutes les quelques secondes sur une file vide ;
- **13 listeners `QueueEvents`** (`QueueAlertingService`, un par file du registre) — chacun une boucle `XREAD BLOCK` qui se réarme de la même façon.

Soit **~26 boucles bloquantes permanentes, même avec zéro activité métier** : ordre de grandeur quelques commandes par seconde, donc plusieurs millions de commandes par mois et par instance, sans qu'aucun client n'ait rien fait.

**Conséquence pratique : un Redis facturé à la requête (Upstash pay-as-you-go et équivalents) est une incompatibilité d'architecture, pas un réglage à ajuster.** Privilégier un Redis à **prix fixe** — on paie une capacité, pas des requêtes de sondage.

Si la facturation à la requête est imposée, deux atténuations, par ordre de rapport gain/risque :

1. `QUEUE_ALERTING_ENABLED=false` — supprime 13 des 26 boucles, soit **la moitié** du trafic au repos, immédiatement. On perd la ligne de log `QUEUE_JOB_FAILED` ; on garde les compteurs `failed` par file, que `GET /health/queues` et `GET /metrics` lisent à la demande. Un scrapeur Prometheus voit donc toujours les échecs, à son intervalle de scrape.
2. Fusionner les 9 schedulers de balayage en une seule file avec un nom de job discriminant (13 workers → 5). Gain important, mais c'est un refactor réel touchant des flux financiers — à ne pas improviser.

Ne pas chercher à réduire les intervalles des schedulers pour économiser : ce ne sont pas eux qui coûtent. Un balayage toutes les 15 minutes représente 4 commandes par heure ; les boucles bloquantes, elles, en représentent des milliers.

## Runbook

Séquencé pour qu'un échec survienne le plus tôt possible. Ne pas réordonner : chaque étape suppose la précédente vérifiée.

**1. Provisionner les données avant tout le reste.** Créer le cluster MongoDB géré (replica set) et le Redis géré. Vérifier depuis la machine de déploiement, pas depuis un poste de dev :

```bash
# Doit afficher "ok" et un myState de 1 (PRIMARY)
mongosh "$MONGODB_URI" --quiet --eval 'db.adminCommand("ping").ok'
mongosh "$MONGODB_URI" --quiet --eval 'rs.status().myState'
redis-cli -u "$REDIS_URL" ping
```

Si `rs.status()` échoue, l'instance n'est pas un replica set — s'arrêter ici, rien d'autre ne sert.

**2. Provisionner l'hôte applicatif.** Étape absente de la première version de ce runbook, ce qui rendait l'étape DNS impossible à exécuter : un enregistrement A doit pointer vers une adresse, et il n'y en a pas avant qu'un hôte existe.

**Ce que `docker-compose.prod.yml` exige de cet hôte**, et qui restreint réellement le choix :

- **Docker + Docker Compose**, et le contrôle des **ports 80 et 443**. Caddy est le point d'entrée TLS ; il doit pouvoir les lier.
- **Une IP publique stable** (v4, et v6 si tu publies des AAAA).
- **Le TLS à la demande pour les domaines des locataires impose que Caddy soit l'edge.** C'est le point qui disqualifie la plupart des PaaS : Vercel, Render ou Fly terminent le TLS eux-mêmes et exposent leur propre API de domaines personnalisés, ils ne laissent pas un Caddy demander des certificats pour des hostnames arbitraires à l'exécution. Avec eux, il faudrait réécrire la résolution de domaine contre leur API au lieu d'utiliser `/public-sites/domain-allowed`.
- **Un volume persistant** pour `/data` de Caddy. Le perdre signifie re-demander chaque certificat au prochain démarrage, soit le moyen le plus rapide d'atteindre les limites de Let's Encrypt.

**En pratique : un VPS** (Hetzner, OVH, Scaleway, DigitalOcean...), pas un PaaS. Dimensionnement de départ raisonnable pour les 3 conteneurs + Caddy : 2 vCPU / 4 Go. Les données vivant chez Atlas et Upstash, l'hôte ne stocke que les images et les certificats.

**Préparation de l'hôte** : `docker/host/bootstrap-vps.sh` fait tout le travail système, et il est idempotent.

```bash
scp docker/host/bootstrap-vps.sh root@<IP>:/root/
ssh root@<IP> 'bash /root/bootstrap-vps.sh korva'
```

Il installe Docker Engine depuis le dépôt officiel (celui d'Ubuntu n'embarque pas le plugin `compose` v2 que ce projet utilise), crée un utilisateur non privilégié avec la clé SSH déjà en place, ferme le pare-feu sauf 22/80/443, active les mises à jour de sécurité automatiques sans redémarrage automatique, ajoute 2 Go de swap, et applique les trois réglages noyau que Redis réclame : `vm.overcommit_memory=1` (sinon le fork de réécriture AOF peut être refusé et l'AOF grossit sans fin), `net.core.somaxconn` relevé (une instance d'API ouvre 26 connexions longues), et la désactivation des Transparent Huge Pages, qui provoquent des pics de latence pendant la persistance de Redis.

**Région** : les bases sont déjà provisionnées, donc choisir la région de l'hôte au plus près du cluster Atlas — chaque requête applicative traverse ce lien, et 80 ms de latence par aller-retour se paient sur toutes les pages.

**3. DNS.** Trois enregistrements A (et AAAA si l'hôte a une IPv6) vers l'IP de l'étape 2 :

| Nom | Type | Valeur |
|---|---|---|
| `DASHBOARD_DOMAIN` (ex. `app.exemple.com`) | A | IP de l'hôte |
| `API_DOMAIN` (ex. `api.exemple.com`) | A | IP de l'hôte |
| `STOREFRONT_DOMAIN` (ex. `sites.exemple.com`) | A | IP de l'hôte |

Les domaines personnalisés des locataires ne figurent pas ici : c'est le locataire qui crée un enregistrement vers cette même IP, et Caddy obtient le certificat à la demande après validation par `/public-sites/domain-allowed`.

Vérifier la propagation **avant** de démarrer Caddy — un Caddy lancé sur un DNS non résolu consomme des tentatives ACME en échec, et Let's Encrypt les limite :

```bash
for d in "$DASHBOARD_DOMAIN" "$API_DOMAIN" "$STOREFRONT_DOMAIN"; do
  echo "$d -> $(dig +short A "$d" | tr '\n' ' ')"
done
```

Chaque ligne doit afficher l'IP de l'hôte. Une ligne vide signifie que la propagation n'est pas terminée : attendre, ne pas démarrer.

**4. Secrets.** `cp .env.production.example .env.production`, puis remplir. Les quatre secrets se génèrent indépendamment :

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET        (jamais la même valeur)
openssl rand -base64 48   # CUSTOMER_JWT_SECRET       (jamais une des deux précédentes)
openssl rand -hex 32      # INTEGRATION_CREDENTIALS_KEY
```

Vérifier que les trois secrets JWT diffèrent réellement — réutiliser une valeur rend un token d'accès fuité également valide comme token de rafraîchissement, ou un token client valide côté dashboard.

**5. Appliquer les migrations — AVANT de démarrer l'API.**

Le runner est **compilé dans l'image** (`dist/migrate.js`), donc il s'exécute depuis l'image de production elle-même — aucun toolchain de développement n'est nécessaire sur l'hôte :

```bash
# Dry run : liste ce qui est en attente, n'écrit rien
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm api node dist/migrate.js

# Application
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm api node dist/migrate.js --apply
```

`run --rm` place le conteneur sur le réseau du compose : le nom d'hôte interne `redis` et l'URI Atlas se résolvent exactement comme pour l'API en fonctionnement, et le service `redis` démarre automatiquement via `depends_on` (voulu — l'application valide `REDIS_URL` au démarrage).

En local, contre la base de développement, la même chose sans Docker :

```bash
pnpm --filter @korva/api build && (cd apps/api && node dist/migrate.js)
```

`autoIndex` est désactivé en production (`app.module.ts`) : Mongoose le laisse à `true` par défaut, ce qui fait démarrer une construction d'index pour chaque modèle à **chaque** démarrage de **chaque** instance — anodin en local, risqué contre un vrai cluster pendant un déploiement progressif. Les index sont donc créés par la migration `0001-sync-indexes`, qui doit tourner **avant** que les nouvelles instances démarrent. Sauter cette étape ne provoque aucune erreur visible : les requêtes deviennent lentes et les contraintes d'unicité n'existent tout simplement pas.

Le runner n'est volontairement pas exécuté au démarrage de l'application : pendant un déploiement progressif, plusieurs instances démarrent en même temps, et trois d'entre elles qui courent après la même migration est exactement la manière d'obtenir une transformation de données à moitié appliquée. Une invocation délibérée depuis le pipeline, c'est tout l'intérêt.

> ⚠️ **Le flag `-r ./scripts/support/ts-extension-resolver.cjs` est obligatoire** pour *tous* les scripts de `apps/api/scripts/`, pas seulement celui-ci. Sans lui, chacun s'arrête sur `Cannot find module './rbac.js'` avant sa première ligne : les packages partagés s'importent avec des extensions `.ts` explicites (ADR-001) que `rewriteRelativeImportExtensions` réécrit en `.js`, lesquels n'existent pas sur disque. Les commandes documentées dans ces scripts étaient toutes fausses jusqu'au 2026-10-12.

**6. Construire et démarrer.**

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

`PUBLIC_API_URL` est injecté à la **construction** (Next.js inline les `NEXT_PUBLIC_*` dans le bundle client). Le modifier plus tard impose de reconstruire web et storefront — le changer seulement dans l'environnement livre silencieusement un bundle pointant vers localhost.

**7. Vérifier que l'application est réellement vivante**, pas seulement que les conteneurs tournent :

```bash
curl -fsS https://$API_DOMAIN/api/v1/health
curl -fsS https://$API_DOMAIN/api/v1/health/database
curl -fsS https://$API_DOMAIN/api/v1/health/redis
curl -fsS https://$API_DOMAIN/api/v1/health/queues     # les 12 files, voir core/queues/queue-registry.ts
curl -fsS -o /dev/null -w '%{http_code}\n' https://$DASHBOARD_DOMAIN/login
```

`/health/database` et `/health/redis` renvoient un message générique en cas de panne — le détail réel est dans les logs du conteneur, jamais dans la réponse HTTP (volontaire, voir §27.4 D4-F de PRODUCTION_READINESS.md). En cas de 503, lire `docker compose -f docker-compose.prod.yml logs api`.

**8. Créer les comptes d'intégration de paiement.** Les clés PSP ne sont pas des variables d'environnement : elles sont chiffrées en base par marché. Il en faut au minimum deux : `role: subscription-billing` **sans `--market`** (facturation des abonnements KORVA — Flow A, indépendant du marché car sa géographie est celle de KORVA, pas celle du locataire) et un `role: merchant-of-record --market <PAYS>` **par pays vendu** (Flow B, résolu depuis `Organization.country` : un locataire dans un pays sans compte ne peut pas être payé du tout). Voir `docs/architecture/integrations-platform.md` §4.

Essai à blanc d'abord — il valide les paramètres et n'écrit rien :

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm --no-deps api node dist/create-platform-integration-account.js \
  --domain payment --provider flutterwave --role merchant-of-record --market CI \
  --secret "<la clé>"
```

Puis `--apply --activate`. **`--activate` n'est pas optionnel en pratique** : le résolveur exige `status === 'active'`, donc un compte créé sans lui se comporte exactement comme un compte absent.

Ce fichier vivait dans `scripts/` jusqu'au 2026-10-18, ce qui rendait cette étape **inexécutable** : l'image ne contient que `dist/`, `packages/` et les `node_modules` de production, donc ni le script ni `ts-node` n'y étaient — et la liste d'autorisation Atlas ne contient que l'IP du VPS, donc le lancer depuis un poste de travail ne marche pas non plus. Il est désormais sous `src/`, compilé dans l'image, pour la même raison que `src/migrate.ts`.

Clés de fournisseur enregistrées : `manual`, `flutterwave`, `paystack` (`payment-provider.registry.ts`). `manual` n'appelle aucune API et n'a pas besoin de secret ; les deux autres échouent en `PAYMENT_PROVIDER_CREDENTIAL_MISSING` sans lui.

Sans le compte `subscription-billing`, `POST /subscriptions/invoices/:id/checkout` renvoie `PAYMENT_PROVIDER_NOT_CONFIGURED` — volontairement, plutôt que de retomber silencieusement sur le fournisseur manuel.

**9. Vérifier un domaine personnalisé de bout en bout**, avec un domaine jetable avant le premier vrai client : le rattacher à une organisation ayant le module `website`, faire pointer son DNS vers l'hôte, puis confirmer que Caddy émet bien un certificat et que le storefront résout le locataire. Un 404 sur le domaine signifie que l'organisation n'a pas `website` activé, pas un problème de proxy.

**10. Surveiller la première exécution de la CI sur `main`.** Le workflow n'a jamais été exécuté depuis cet environnement (pas d'accès à GitHub Actions) — voir §Intégration continue.

### Ce que ce runbook ne couvre pas

Sauvegardes et restauration testée (à configurer côté fournisseur géré), bascule et scaling horizontal, agrégation des logs vers un collecteur externe (le `StructuredLogger` émet du JSON sur stdout, prêt à être collecté, mais aucun collecteur n'est configuré), et rotation des secrets. `INTEGRATION_CREDENTIALS_KEY` en particulier n'est pas rotable sans ressaisie : la changer rend indéchiffrables toutes les informations d'identification déjà stockées.

## Hors scope (MVP) — état historique

Cette section décrit le périmètre du MVP et n'est plus exacte : les certificats TLS et les domaines personnalisés par organisation sont désormais couverts par les manifestes ci-dessus, et le scan de dépendances est en CI. Restent effectivement hors périmètre : l'hébergement réel (aucun provider provisionné), le scaling horizontal / l'orchestration (Kubernetes, etc.), image Docker pour `apps/worker` (squelette non utilisé, depuis retiré du dépôt — voir `docs/IMPLEMENTATION_PLAN.md` §21.0). Le scan de vulnérabilités automatisé en CI, listé ici comme hors scope à l'origine, a depuis été ajouté (`.github/dependabot.yml`, `.github/workflows/codeql.yml` — voir [security.md](security.md)).
