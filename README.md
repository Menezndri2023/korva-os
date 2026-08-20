# KORVA OS

Business Operating System SaaS multi-tenant pour PME, indépendants et entreprises de services — CRM, catalogue, réservations, e-commerce, finance, communication, automatisation et assistant IA depuis une seule plateforme.

KORVA est conçu comme une plateforme configurable, indépendante de tout secteur d'activité. Voir [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) pour la feuille de route complète et [docs/architecture.md](docs/architecture.md) pour l'architecture détaillée.

## Stack

- **Frontend** — Next.js, TypeScript, Tailwind CSS, TanStack Query, React Hook Form + Zod
- **Backend** — NestJS, MongoDB/Mongoose, Redis/BullMQ
- **Monorepo** — pnpm workspaces

## Structure

```
korva-os/
├── apps/
│   ├── web/          # Dashboard SaaS (Next.js)
│   ├── api/           # Backend NestJS
│   ├── worker/         # Workers BullMQ
│   └── storefront/     # Site public par organisation
├── packages/
│   ├── ui/             # Composants partagés
│   ├── config/         # tsconfig partagés
│   ├── types/          # Types TypeScript partagés
│   ├── validation/      # Schémas Zod partagés
│   └── eslint-config/
├── infrastructure/
├── docs/
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## Démarrage

Prérequis : Node.js ≥ 22.6 (exécution native de TypeScript requise par les packages partagés, voir [docs/architecture-decisions.md](docs/architecture-decisions.md) ADR-001 — `26` recommandé, voir `.nvmrc`), pnpm, Docker.

```bash
git clone https://github.com/Menezndri2023/korva-os.git
cd korva-os
pnpm install
cp .env.example .env        # puis compléter au minimum JWT_SECRET/JWT_REFRESH_SECRET
docker compose up -d        # MongoDB + Redis

pnpm --filter @korva/api start:dev
pnpm --filter @korva/web dev
```

L'API écoute par défaut sur `http://localhost:4000/api/v1` (doc Swagger sur `/api/v1/docs` en développement), le dashboard sur `http://localhost:3000`.

## Tests

```bash
pnpm --filter @korva/api test        # unit
pnpm --filter @korva/api test:e2e    # e2e — nécessite MongoDB/Redis via docker compose
```

## Documentation

- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — feuille de route et statut par phase
- [docs/architecture.md](docs/architecture.md) · [docs/database.md](docs/database.md) · [docs/multi-tenancy.md](docs/multi-tenancy.md) · [docs/api.md](docs/api.md) · [docs/ai.md](docs/ai.md)
- [docs/security.md](docs/security.md) — modèle d'authentification, isolation, secrets, lacunes connues
- [docs/deployment.md](docs/deployment.md) — images Docker de production, CI, variables d'environnement
- [docs/architecture-decisions.md](docs/architecture-decisions.md) — décisions techniques et bugs d'environnement documentés au fil du projet

## Déploiement

Images Docker de production pour `apps/api`/`apps/web`/`apps/storefront` (voir [docs/deployment.md](docs/deployment.md)) et intégration continue (`.github/workflows/ci.yml`) — aucun hébergement réel provisionné au MVP.

## Licence

Voir [LICENSE](LICENSE).
