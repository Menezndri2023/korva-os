# Déploiement — KORVA OS

Créé en Phase 12 (Hardening). Couvre les images Docker de production, l'intégration continue et les variables d'environnement — pas d'hébergement réel provisionné (hors scope du MVP).

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

Voir `.env.example` pour la liste complète. Obligatoires (`validateEnv` refuse de démarrer sans elles) : `MONGODB_URI`, `REDIS_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`. Toutes les autres (`CORS_ORIGINS`, clés de fournisseurs externes...) ont un comportement de repli sûr — voir [security.md](security.md).

## Health checks

```
GET /api/v1/health            (liveness générique)
GET /api/v1/health/database
GET /api/v1/health/redis
```

## Intégration continue

`.github/workflows/ci.yml` — sur chaque push vers `main` et chaque pull request : `pnpm -r typecheck`, `pnpm -r lint`, `pnpm -r build`, tests unitaires et e2e de `apps/api` (MongoDB 7 + Redis 7 démarrés comme services du job, mêmes identifiants que `docker-compose.yml`). Reproduit exactement la séquence de vérification suivie manuellement à la fin de chaque phase de ce projet (voir Definition of Done, `docs/IMPLEMENTATION_PLAN.md`).

**Non vérifié par exécution réelle** (pas d'accès à GitHub Actions depuis cet environnement) — le workflow a été relu attentivement et reproduit exactement les commandes validées manuellement des dizaines de fois pendant ce projet, mais sa toute première exécution sur GitHub doit être surveillée.

## Hors scope (MVP)

Hébergement réel (aucun provider choisi/provisionné), certificats TLS, domaines personnalisés par organisation (voir [architecture.md](architecture.md), Phase 11), scaling horizontal / orchestration (Kubernetes, etc.), image Docker pour `apps/worker` (squelette non utilisé), scan de vulnérabilités automatisé en CI (voir [security.md](security.md)).
