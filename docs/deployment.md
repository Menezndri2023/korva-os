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

**2. DNS.** Faire pointer `DASHBOARD_DOMAIN`, `API_DOMAIN` et `STOREFRONT_DOMAIN` (enregistrements A/AAAA) vers l'hôte. Attendre la propagation **avant** de démarrer Caddy : un Caddy qui démarre sur un DNS non propagé consomme des tentatives ACME en échec.

**3. Secrets.** `cp .env.production.example .env.production`, puis remplir. Les quatre secrets se génèrent indépendamment :

```bash
openssl rand -base64 48   # JWT_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET        (jamais la même valeur)
openssl rand -base64 48   # CUSTOMER_JWT_SECRET       (jamais une des deux précédentes)
openssl rand -hex 32      # INTEGRATION_CREDENTIALS_KEY
```

Vérifier que les trois secrets JWT diffèrent réellement — réutiliser une valeur rend un token d'accès fuité également valide comme token de rafraîchissement, ou un token client valide côté dashboard.

**4. Appliquer les migrations — AVANT de démarrer l'API.**

```bash
# Dry run : liste ce qui est en attente, n'écrit rien
pnpm --filter @korva/api exec ts-node \
  -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register \
  scripts/migrate.ts

# Application
pnpm --filter @korva/api exec ts-node \
  -r ./scripts/support/ts-extension-resolver.cjs -r tsconfig-paths/register \
  scripts/migrate.ts --apply
```

`autoIndex` est désactivé en production (`app.module.ts`) : Mongoose le laisse à `true` par défaut, ce qui fait démarrer une construction d'index pour chaque modèle à **chaque** démarrage de **chaque** instance — anodin en local, risqué contre un vrai cluster pendant un déploiement progressif. Les index sont donc créés par la migration `0001-sync-indexes`, qui doit tourner **avant** que les nouvelles instances démarrent. Sauter cette étape ne provoque aucune erreur visible : les requêtes deviennent lentes et les contraintes d'unicité n'existent tout simplement pas.

Le runner n'est volontairement pas exécuté au démarrage de l'application : pendant un déploiement progressif, plusieurs instances démarrent en même temps, et trois d'entre elles qui courent après la même migration est exactement la manière d'obtenir une transformation de données à moitié appliquée. Une invocation délibérée depuis le pipeline, c'est tout l'intérêt.

> ⚠️ **Le flag `-r ./scripts/support/ts-extension-resolver.cjs` est obligatoire** pour *tous* les scripts de `apps/api/scripts/`, pas seulement celui-ci. Sans lui, chacun s'arrête sur `Cannot find module './rbac.js'` avant sa première ligne : les packages partagés s'importent avec des extensions `.ts` explicites (ADR-001) que `rewriteRelativeImportExtensions` réécrit en `.js`, lesquels n'existent pas sur disque. Les commandes documentées dans ces scripts étaient toutes fausses jusqu'au 2026-10-12.

**5. Construire et démarrer.**

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

`PUBLIC_API_URL` est injecté à la **construction** (Next.js inline les `NEXT_PUBLIC_*` dans le bundle client). Le modifier plus tard impose de reconstruire web et storefront — le changer seulement dans l'environnement livre silencieusement un bundle pointant vers localhost.

**6. Vérifier que l'application est réellement vivante**, pas seulement que les conteneurs tournent :

```bash
curl -fsS https://$API_DOMAIN/api/v1/health
curl -fsS https://$API_DOMAIN/api/v1/health/database
curl -fsS https://$API_DOMAIN/api/v1/health/redis
curl -fsS https://$API_DOMAIN/api/v1/health/queues     # les 12 files, voir core/queues/queue-registry.ts
curl -fsS -o /dev/null -w '%{http_code}\n' https://$DASHBOARD_DOMAIN/login
```

`/health/database` et `/health/redis` renvoient un message générique en cas de panne — le détail réel est dans les logs du conteneur, jamais dans la réponse HTTP (volontaire, voir §27.4 D4-F de PRODUCTION_READINESS.md). En cas de 503, lire `docker compose -f docker-compose.prod.yml logs api`.

**7. Créer les comptes d'intégration de paiement.** Les clés PSP ne sont pas des variables d'environnement : elles sont chiffrées en base par marché. Voir `scripts/create-platform-integration-account.ts` et `docs/architecture/integrations-platform.md` §4. Il en faut au minimum deux : `role: subscription-billing` (facturation des abonnements KORVA) et un `role: merchant-of-record` par marché de locataire. Sans le premier, `POST /subscriptions/invoices/:id/checkout` renvoie `PAYMENT_PROVIDER_NOT_CONFIGURED` — volontairement, plutôt que de retomber silencieusement sur le fournisseur manuel.

**8. Vérifier un domaine personnalisé de bout en bout**, avec un domaine jetable avant le premier vrai client : le rattacher à une organisation ayant le module `website`, faire pointer son DNS vers l'hôte, puis confirmer que Caddy émet bien un certificat et que le storefront résout le locataire. Un 404 sur le domaine signifie que l'organisation n'a pas `website` activé, pas un problème de proxy.

**9. Surveiller la première exécution de la CI sur `main`.** Le workflow n'a jamais été exécuté depuis cet environnement (pas d'accès à GitHub Actions) — voir §Intégration continue.

### Ce que ce runbook ne couvre pas

Sauvegardes et restauration testée (à configurer côté fournisseur géré), bascule et scaling horizontal, agrégation des logs vers un collecteur externe (le `StructuredLogger` émet du JSON sur stdout, prêt à être collecté, mais aucun collecteur n'est configuré), et rotation des secrets. `INTEGRATION_CREDENTIALS_KEY` en particulier n'est pas rotable sans ressaisie : la changer rend indéchiffrables toutes les informations d'identification déjà stockées.

## Hors scope (MVP) — état historique

Cette section décrit le périmètre du MVP et n'est plus exacte : les certificats TLS et les domaines personnalisés par organisation sont désormais couverts par les manifestes ci-dessus, et le scan de dépendances est en CI. Restent effectivement hors périmètre : l'hébergement réel (aucun provider provisionné), le scaling horizontal / l'orchestration (Kubernetes, etc.), image Docker pour `apps/worker` (squelette non utilisé, depuis retiré du dépôt — voir `docs/IMPLEMENTATION_PLAN.md` §21.0). Le scan de vulnérabilités automatisé en CI, listé ici comme hors scope à l'origine, a depuis été ajouté (`.github/dependabot.yml`, `.github/workflows/codeql.yml` — voir [security.md](security.md)).
