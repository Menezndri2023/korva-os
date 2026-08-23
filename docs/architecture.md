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
Workers BullMQ (in-process dans apps/api — apps/worker retiré, voir ADR-005 et docs/IMPLEMENTATION_PLAN.md §21.0)
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
- **COMMUNICATION** — conversations, messages, templates, notifications. `EmailProvider`/`MessagingProvider` réellement branchés (voir section EventBus ci-dessous) ; `notifications` sont internes à l'organisation, diffusées via `NotificationsService.notifyOrganization()`.
- **ANALYTICS** — agrégation de KPIs, endpoints `/analytics/*`.
- **AI** — `AIProvider` réel (Anthropic), orchestrateur (boucle tool-calling), 4 agents, 19 tools réutilisant les services métier existants, confirmation humaine pour les actions sensibles. RAG non implémenté (architecture-ready seulement, voir [ai.md](ai.md)).
- **SUBSCRIPTIONS** — catalogue de plans (seed paresseux, voir ADR-009), abonnement par organisation (créé automatiquement à `"free"`), `EntitlementsService` (source de vérité pour l'accès aux modules, les sièges d'équipe et les quotas d'usage — ex. `ai_messages_per_month`), pas d'intégration de facturation réelle au MVP.
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
| `AIProvider` | `AnthropicAIProvider` (réel) si `AI_API_KEY` configuré, sinon `NullAIProvider` par défaut — voir [ai.md](ai.md) |

Chaque abstraction expose une interface stable ; le domaine métier n'appelle jamais un SDK tiers directement.

## EventBus & asynchrone

Toute action métier significative émet un événement (`customer.created`, `lead.created`, `quote.created`, `quote.accepted`, `order.created`, `payment.completed`, `booking.created`, `booking.cancelled`, ...) via `EventBusService.publish(organizationId, name, payload)` (`apps/api/src/core/events/`, module `@Global()`). `publish()` pousse uniquement un job sur une queue BullMQ/Redis (`events`) et ne fait jamais attendre la requête HTTP qui l'a émis — une erreur de publication est loguée mais n'échoue jamais l'opération métier.

Le module **WORKFLOW** (`apps/api/src/workflow/`) est le premier consommateur de cette queue : `EventsProcessor` (un `Worker` BullMQ) reçoit chaque événement, `WorkflowEngineService` retrouve les workflows actifs déclenchés par ce nom d'événement, évalue leurs `conditions` (AND, dot-path dans le payload) puis exécute leurs `actions` (`create_task`, `send_email` — réel via `EmailProvider` depuis la Phase 8, `webhook`, `internal_notification` — diffuse une Notification à toute l'organisation via `CommunicationModule`), et journalise le résultat dans `workflow_executions`.

**Note d'architecture** : ce `Worker` tourne *dans le processus `apps/api`*, pour réutiliser directement les services Nest existants (ex. `TasksService`) sans dupliquer de modules métier entre deux process. Voir [ADR-005](architecture-decisions.md#adr-005--eventsprocessor-worker-bullmq-du-workflow-engine-colocalisé-dans-appsapi-pas-dans-appsworker) pour le raisonnement historique de cette décision (prise quand `apps/worker` existait encore comme squelette). `apps/worker` a depuis été retiré du dépôt (commit `c33edd6` — voir `docs/IMPLEMENTATION_PLAN.md` §21.0) ; le chemin de migration que l'ADR envisageait vers `apps/worker` n'a plus de cible et tout traitement asynchrone actuel (events, réconciliation Payment/Refund) tourne dans `apps/api`.

## Frontend

- `apps/web` : dashboard SaaS, App Router, sidebar dynamique n'affichant que les modules activés par l'organisation.
- `apps/storefront` : site public par organisation, alimenté uniquement par l'API publique (jamais d'accès direct aux données internes). Routage MVP par chemin (`/:organizationSlug`, voir Phase 11) — routage par sous-domaine (`company.korva.app`) puis domaines personnalisés restent architecture-ready mais non implémentés (aucun middleware de résolution d'hôte).

## Observabilité

Endpoints `/health`, `/health/database`, `/health/redis`. Logs structurés partout. Architecture prête pour Sentry et métriques, sans intégration obligatoire au MVP.

## Documents liés

[database.md](database.md) · [multi-tenancy.md](multi-tenancy.md) · [api.md](api.md) · [ai.md](ai.md) · [security.md](security.md) · [deployment.md](deployment.md) · [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md)
