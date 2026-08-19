# KORVA OS — Implementation Plan

Statut : PHASE 1 (Foundation) terminée et validée — voir section 9. PHASE 2 (CRM) non démarrée.
Dernière mise à jour : 2026-08-19

## 1. Résumé du produit

KORVA OS est un Business Operating System SaaS multi-tenant générique (pas de logique métier sectorielle en dur) permettant à une organisation de gérer CRM, catalogue, réservations, e-commerce, finance, communication, automatisation et un assistant IA depuis une seule plateforme.

Contrainte explicite : aucun module ou logique spécifique automobile / VIT-AUTO dans ce projet.

## 2. Architecture cible

```
Frontend (Next.js)
    ↓
API Gateway / Backend (NestJS)
    ↓
Domain Modules (Core, Identity, Organizations, CRM, Catalog, Booking,
                Commerce, Finance, Workflow, Communication, Analytics,
                AI, Subscriptions, Files, Audit, API/Webhooks)
    ↓
MongoDB · Redis · Object Storage · Queues (BullMQ) · External Providers
```

Style : **Modular Monolith + Workers asynchrones**. Pas de microservices au MVP — le découpage en modules doit permettre une extraction future si nécessaire.

Détails complets : voir [architecture.md](architecture.md), [database.md](database.md), [multi-tenancy.md](multi-tenancy.md), [api.md](api.md), [ai.md](ai.md).

## 3. Monorepo

Gestionnaire : pnpm workspaces.

```
korva/
├── apps/
│   ├── web/          # Dashboard SaaS (Next.js)
│   ├── api/           # Backend NestJS
│   ├── worker/         # Workers BullMQ
│   └── storefront/     # Site public par organisation
├── packages/
│   ├── ui/             # Composants partagés (shadcn/ui based)
│   ├── config/         # Config partagée (eslint, tsconfig, tailwind)
│   ├── types/          # Types TypeScript partagés
│   ├── validation/      # Schémas Zod partagés
│   └── eslint-config/
├── infrastructure/
│   ├── docker/
│   └── scripts/
├── docs/
├── .env.example
├── docker-compose.yml
├── pnpm-workspace.yaml
└── package.json
```

Note : ce plan est actuellement écrit à la racine du repo `korva-os` (qui *devient* la racine du monorepo `korva/` décrite ci-dessus — pas un sous-dossier séparé).

## 4. Environnement vérifié (audit du 2026-08-19)

| Outil | Statut | Version |
|---|---|---|
| Node.js | OK | v26.0.0 |
| npm | OK | 11.12.1 |
| pnpm | Installé pendant l'audit | 11.22.0 |
| Docker | OK | 29.6.2 |
| Docker Compose | OK | v5.3.1 |
| Git | OK | 2.39.5, repo initialisé, remote `origin` = `github.com/Menezndri2023/korva-os.git` |
| MongoDB local | Absent | Utilisation via Docker Compose |
| Redis local | Absent | Utilisation via Docker Compose |

Repo existant avant ce plan : squelette minimal (`README.md`, `LICENSE`, `.gitignore`), aucun code applicatif. Départ à zéro pour l'implémentation.

Risque identifié : Node v26 est une version très récente ; à surveiller pour compatibilité avec NestJS/Next.js et leurs dépendances lors de l'installation (voir section Risques).

## 5. Phases (ordre obligatoire, ne pas paralléliser)

### PHASE 1 — Foundation
- Monorepo pnpm (structure ci-dessus)
- `apps/web` (Next.js + TS + App Router + Tailwind + shadcn/ui)
- `apps/api` (NestJS + TS + Swagger)
- `apps/worker` (BullMQ skeleton)
- MongoDB + Redis via Docker Compose
- Auth (register/login/logout/refresh) — module IDENTITY
- Organizations — module ORGANIZATIONS
- Multi-tenancy (TenantContext, isolation)
- RBAC (rôles système + permissions)
- Tests d'isolation tenant de base

### PHASE 2 — CRM
contacts, leads, pipelines, activities, tasks, notes, tags, custom fields

### PHASE 3 — Catalog
offers (product/service/booking/digital_product/subscription/package), catégories, pricing

### PHASE 4 — Finance
quotes, invoices, PaymentProvider abstraction (sans intégration live obligatoire)

### PHASE 5 — Booking
resources, availability, calendar, bookings

### PHASE 6 — Commerce
cart, checkout, orders (Order Engine partagé avec Booking)

### PHASE 7 — Workflow
event bus, triggers, conditions, actions, BullMQ jobs

### PHASE 8 — Communication
email, notifications internes, templates (architecture prête WhatsApp)

### PHASE 9 — AI
AI Gateway, orchestrator, context builder, memory, tools sécurisés, Sales Agent, RAG architecture-ready

### PHASE 10 — SaaS
plans, subscriptions, EntitlementService, usage tracking

### PHASE 11 — Storefront
pages publiques, booking, e-commerce, checkout, custom domains architecture-ready

### PHASE 12 — Hardening
sécurité, tests complets, performance, documentation, déploiement

Règle : chaque phase se termine par tests + typecheck + lint + build avant de démarrer la suivante (voir Definition of Done, section 57 du brief produit).

## 6. Dépendances entre phases

- Phase 2+ dépendent toutes de Phase 1 (auth, tenant context, RBAC).
- Phase 6 (Commerce) dépend de Phase 3 (Catalog/offers) et introduit l'Order Engine que Phase 5 (Booking) doit aussi utiliser — donc l'Order Engine doit être conçu en Phase 6 en gardant Booking en tête (retrofit léger de Phase 5 si besoin).
- Phase 7 (Workflow) dépend des événements émis par CRM, Finance, Booking, Commerce — donc l'EventBus doit être posé dès Phase 1 (Core) même si peu utilisé avant Phase 7.
- Phase 9 (AI) dépend des services métier de toutes les phases précédentes (les tools IA appellent les services existants, jamais MongoDB directement).
- Phase 10 (Subscriptions/Entitlements) doit exposer `canUse(module)` utilisable dès Phase 1 pour l'activation des modules par organisation, même si les plans réels arrivent en Phase 10.

## 7. Risques

| Risque | Impact | Mitigation |
|---|---|---|
| Node v26 très récent, écosystème NestJS/Next.js pas toujours testé dessus | Bloque install ou build | Épingler les versions de dépendances compatibles, tester le build dès Phase 1, prévoir un `.nvmrc`/`engines` explicite |
| organizationId accepté depuis le body (faille tenant) | Fuite de données cross-tenant | TenantContext systématique + tests d'isolation obligatoires dès Phase 1 |
| Complexité de l'Order Engine partagé Booking/Commerce | Retard Phase 5/6 | Concevoir le modèle Order dès Phase 1 (Core) même si non exposé avant Phase 6 |
| Sur-ingénierie prématurée (microservices, features non demandées) | Perte de temps, dette | Respect strict des règles de développement (monolithe modulaire, pas de features hors scope) |
| IA avec accès direct aux données | Faille de sécurité majeure | AI Gateway → tools métier uniquement, jamais d'accès Mongo direct, audit systématique |

## 8. Décisions techniques (voir aussi docs/architecture-decisions.md, créé au fil de l'eau)

- Monolithe modulaire NestJS plutôt que microservices — simplicité et vitesse d'itération au MVP, extraction future possible car les modules sont déjà isolés par domaine.
- MongoDB partagé avec isolation par `organizationId` sur chaque collection tenant-aware plutôt que base par tenant — coût opérationnel réduit, isolation strictement appliquée au niveau applicatif (TenantContext + tests).
- Abstractions obligatoires pour tout fournisseur externe (Payment, Email, Storage, Messaging, AI) — évite le couplage et permet le support multi-région (Stripe/CinetPay/Paystack/Flutterwave).

## 9. Statut PHASE 1 (Foundation) — terminée

Livré et validé (typecheck + lint + build + tests sur tout le monorepo, plus test manuel end-to-end via curl) :

- Monorepo pnpm complet (4 apps + 5 packages partagés), Docker Compose (MongoDB + Redis).
- API NestJS `/api/v1` : auth (register/login/refresh avec rotation/logout), organizations (create/update/me/members), RBAC (6 rôles système auto-seedés par organisation + permissions `resource.action`), audit log, health checks.
- TenantContext résolu server-side (header `X-Organization-Id` vérifié contre les memberships réels, jamais fait confiance au client) + guards globaux (auth → tenant → permissions).
- Dashboard Next.js : login, register, onboarding (création d'organisation + sélection des modules), shell dashboard avec sidebar dynamique, page équipe/paramètres.
- Suite de tests e2e dédiée à l'isolation tenant (accès croisé refusé, header manquant refusé, accès légitime accepté) + enforcement RBAC + tests unitaires ; voir `apps/api/test/tenant-isolation.e2e-spec.ts`.
- Deux bugs d'environnement significatifs trouvés et corrigés — documentés dans `docs/architecture-decisions.md` (ADR-001 résolution d'extensions TS sous Node v26, ADR-002 cast explicite `ObjectId` requis pour les queries Mongoose dans cet environnement).

Non fait volontairement en Phase 1 (hors scope, arrive avec les modules concernés) : listing des rôles/permissions via API, gestion des sessions/API keys avancée, custom fields, tout ce qui est CRM/Catalog/Booking/etc.

## 10. Prochaine étape

Démarrer PHASE 2 (CRM) : contacts, leads, pipelines, activities, tasks, notes, tags, custom fields — en réutilisant TenantContext/RBAC/audit déjà en place.
