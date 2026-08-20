# Architecture — KORVA OS

## Style architectural

Modular Monolith + Workers asynchrones. Pas de microservices au MVP (voir [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)).

```
Frontend (apps/web, apps/storefront)
    ↓ HTTP/REST (/api/v1)
Backend NestJS (apps/api)
    ↓
Domain Modules
    ↓
MongoDB · Redis · Object Storage · BullMQ Queues · External Providers
    ↑
Workers (apps/worker)
```

## Modules (domaines fonctionnels)

Chaque module est isolé : sa propre couche controller → service → repository, ses propres modèles Mongoose, aucune dépendance directe à MongoDB depuis un controller.

- **CORE** — configuration, TenantContext, feature flags, activation des modules, error handling, logging, utilitaires partagés, EventBus.
- **IDENTITY** — users, memberships, roles, permissions, sessions, api_keys, auth.
- **ORGANIZATIONS** — organizations, settings, modules activés.
- **CRM** — contacts, leads, pipelines, activities, tasks, notes, tags, custom fields.
- **CATALOG** — offers (product/service/booking/digital_product/subscription/package).
- **BOOKING** — resources, availability, bookings.
- **COMMERCE** — carts, orders, fulfillments. Order Engine unifié (voir section 18 du brief produit) : Cart→Order, Booking→Order et création manuelle convergent tous vers la même entité `Order`, qui génère ensuite une `Invoice` en réutilisant le module Finance.
- **FINANCE** — quotes, invoices, payments, refunds.
- **WORKFLOW** — workflows, workflow_executions (trigger/condition/action).
- **COMMUNICATION** — conversations, messages, templates, notifications.
- **ANALYTICS** — agrégation de KPIs, endpoints `/analytics/*`.
- **AI** — AI Gateway, orchestrator, agents, tools, memory, RAG.
- **SUBSCRIPTIONS** — plans, subscriptions, EntitlementService, usage.
- **FILES** — StorageProvider abstraction (upload/download/delete/getPublicUrl).
- **AUDIT** — audit_logs.
- **API/WEBHOOKS** — webhooks sortants, api_keys.

## Couche par module

```
Controller  → validation d'entrée (Zod/class-validator), aucune logique métier
    ↓
Service     → logique métier, orchestration, appel EventBus
    ↓
Repository  → accès Mongoose exclusif à la collection du module
```

Règle stricte : un controller n'accède jamais directement à Mongoose/MongoDB.

## Abstractions de fournisseurs (jamais de couplage direct)

| Abstraction | Fournisseurs prévus |
|---|---|
| `PaymentProvider` | Stripe, CinetPay, Paystack, Flutterwave |
| `EmailProvider` | Resend, SMTP |
| `StorageProvider` | Local (dev), S3-compatible, Cloudinary/R2 (futur) |
| `MessagingProvider` | WhatsApp Business API, SMS, Email, Push |
| `AIProvider` | abstrait derrière l'AI Gateway (voir [ai.md](ai.md)) |

Chaque abstraction expose une interface stable ; le domaine métier n'appelle jamais un SDK tiers directement.

## EventBus & asynchrone

Toute action métier significative émet un événement (`lead.created`, `order.created`, `payment.completed`, ...). Les traitements longs (emails, PDF, IA, webhooks) sont déportés vers `apps/worker` via BullMQ/Redis — jamais bloquants sur la requête HTTP.

## Frontend

- `apps/web` : dashboard SaaS, App Router, sidebar dynamique n'affichant que les modules activés par l'organisation.
- `apps/storefront` : site public par organisation (`company.korva.app`, puis domaines custom), alimenté uniquement par l'API publique (jamais d'accès direct aux données internes).

## Observabilité

Endpoints `/health`, `/health/database`, `/health/redis`. Logs structurés partout. Architecture prête pour Sentry et métriques, sans intégration obligatoire au MVP.

## Documents liés

[database.md](database.md) · [multi-tenancy.md](multi-tenancy.md) · [api.md](api.md) · [ai.md](ai.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
