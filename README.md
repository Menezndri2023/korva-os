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

Prérequis : Node.js ≥ 20, pnpm, Docker.

```bash
git clone https://github.com/Menezndri2023/korva-os.git
cd korva-os
pnpm install
cp .env.example .env        # puis compléter les secrets JWT, API keys, etc.
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

## Licence

Voir [LICENSE](LICENSE).
