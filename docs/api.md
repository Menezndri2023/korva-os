# API — KORVA OS

Backend NestJS, API REST versionnée sous `/api/v1`, documentée via Swagger/OpenAPI (disponible en développement).

Format de réponse standard — voir aussi gestion d'erreurs et pagination ci-dessous.

## Format de réponse

Succès (objet) :
```json
{ "success": true, "data": { } }
```

Succès (liste) :
```json
{
  "success": true,
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Erreur :
```json
{
  "success": false,
  "error": { "code": "string", "message": "string", "details": {} }
}
```

## Pagination & recherche

Toutes les listes supportent `page`, `limit`, `sort`, `search`, et des filtres spécifiques par ressource. Architecture pensée pour permettre une migration vers cursor pagination plus tard sans changer le contrat public.

## Auth

```
POST /auth/register
POST /auth/login
POST /auth/refresh
POST /auth/logout
```

## Organizations

```
GET   /organizations/me
PATCH /organizations/me
GET   /organizations/me/members
POST  /organizations/me/members
```

## CRM

```
GET    /contacts               (?page, ?limit, ?search, ?tag)
POST   /contacts
GET    /contacts/:id
PATCH  /contacts/:id
DELETE /contacts/:id

GET    /leads                  (?page, ?limit, ?pipelineId, ?stageId, ?status, ?ownerId)
POST   /leads
GET    /leads/:id
PATCH  /leads/:id

GET    /pipelines
POST   /pipelines
GET    /pipelines/:id
PATCH  /pipelines/:id

GET    /activities             (?entity=contact|lead&entityId=...)
POST   /activities

GET    /tasks                  (?status, ?assigneeId, ?entity, ?entityId)
POST   /tasks
PATCH  /tasks/:id

GET    /notes                  (?entity=contact|lead&entityId=...)
POST   /notes

GET    /tags
POST   /tags
```

## Custom Fields

Générique, réutilisable par plusieurs modules (`contacts`, `leads`, `products`, `services`, `bookings`, `orders` — voir [database.md](database.md)) :

```
GET    /custom-fields?entity=contacts
POST   /custom-fields
PATCH  /custom-fields/:id
DELETE /custom-fields/:id
```

## Catalog

```
GET    /offers               (?page, ?limit, ?search, ?type, ?status, ?category)
POST   /offers
GET    /offers/:id
PATCH  /offers/:id
DELETE /offers/:id
```

## Booking

```
GET    /resources                          (?active=true)
POST   /resources
GET    /resources/:id
PATCH  /resources/:id
POST   /resources/:id/blocked-slots
DELETE /resources/:id/blocked-slots/:slotId

GET  /availability?resourceId=&date=       (vue jour : horaires, réservations, créneaux bloqués)

GET  /bookings                             (?page, ?limit, ?resourceId, ?status, ?contactId, ?from, ?to)
POST /bookings
GET  /bookings/:id
PATCH /bookings/:id                        (notes uniquement)
POST /bookings/:id/reschedule
POST /bookings/:id/cancel
```

La disponibilité (horaires hebdomadaires, créneaux bloqués, capacité, chevauchement avec les réservations actives) est vérifiée côté serveur à la création et à la reprogrammation — jamais fait confiance au client.

## Commerce

Le catalogue produit est servi par `/offers` (voir section Catalog) — pas d'endpoint `/products` séparé, cohérent avec l'entité `Offer` générique.

```
GET    /carts?contactId=              (récupère ou crée le panier ouvert du contact)
GET    /carts/:id
POST   /carts/:id/items
PATCH  /carts/:id/items/:itemId
DELETE /carts/:id/items/:itemId
POST   /carts/:id/checkout            (panier -> commande "pending", panier marqué "converted")

GET  /orders                          (?page, ?limit, ?status, ?contactId)
GET  /orders/:id
POST /orders                          (commande manuelle, avec lignes)
POST /orders/from-booking             (crée une commande à partir d'une réservation confirmée)
POST /orders/:id/confirm
POST /orders/:id/cancel
POST /orders/:id/fulfill              (crée aussi l'enregistrement Fulfillment)
POST /orders/:id/generate-invoice     (commande confirmée/livrée -> Invoice via Finance)

GET   /fulfillments?orderId=
PATCH /fulfillments/:id
```

**Order Engine unifié** (voir section 18 du brief produit et `docs/architecture.md`) : Cart → Order, Booking → Order, et création manuelle convergent tous vers la même entité `Order`, qui peut ensuite générer une `Invoice` (réutilisant intégralement le module Finance — mêmes règles de calcul des totaux, mêmes endpoints de paiement).

## Finance

```
GET  /quotes                       (?page, ?limit, ?status, ?contactId)
POST /quotes
GET  /quotes/:id
PATCH /quotes/:id                  (draft only)
POST /quotes/:id/send              (draft -> sent)
POST /quotes/:id/accept            (sent|viewed -> accepted)
POST /quotes/:id/reject            (sent|viewed -> rejected)
POST /quotes/:id/convert-to-invoice (accepted -> creates an Invoice)

GET  /invoices                     (?page, ?limit, ?status, ?contactId)
POST /invoices
GET  /invoices/:id
PATCH /invoices/:id                (draft only)
POST /invoices/:id/issue           (draft -> issued)
POST /invoices/:id/cancel

GET  /payments                     (?invoiceId)
POST /payments                     (records a payment against an invoice)
POST /payments/refunds             (partial or full refund of a payment)
```

Les totaux (`subtotal`/`taxTotal`/`total`) sont toujours recalculés côté serveur à partir des lignes — jamais acceptés depuis le client. Les paiements passent par l'abstraction `PaymentProvider` (voir [architecture.md](architecture.md)) ; le provider par défaut du MVP (`manual`) représente un encaissement enregistré manuellement (espèces, virement).

## Workflow

```
GET    /workflows
POST   /workflows
GET    /workflows/:id
PATCH  /workflows/:id
DELETE /workflows/:id
GET    /workflows/:id/executions
POST   /workflows/:id/test          (dry-run : évalue les conditions sur un payload donné, n'exécute aucune action)
```

Un workflow associe un `trigger` (un des [événements système](#event-bus--événements-système)), une liste de `conditions` (AND, dot-path dans le payload de l'événement, opérateurs `equals`/`not_equals`/`greater_than`/`less_than`/`contains`) et une liste d'`actions` (`create_task`, `send_email`, `webhook`, `internal_notification` — diffuse une [Notification](#communication) à tous les membres actifs de l'organisation). Les publications d'événements (`EventBusService.publish`) ne font que pousser un job sur la queue Redis `events` — jamais de traitement synchrone avec la requête HTTP qui a déclenché l'événement. Voir [architecture.md](architecture.md) (Event Bus) et [ADR-005](architecture-decisions.md#adr-005--eventsprocessor-worker-bullmq-du-workflow-engine-colocalisé-dans-appsapi-pas-dans-appsworker).

### Event Bus — événements système

Événements actuellement publiés par les modules métier (déclencheurs valides pour un workflow) :
```
customer.created
lead.created
quote.created
quote.accepted
order.created
payment.completed
booking.created
booking.cancelled
```
`quote.expired` et `invoice.overdue` sont des déclencheurs valides côté validation mais ne sont pas encore émis (pas de scheduler/cron en Phase 7 — ces deux événements en dépendent).

## Communication

```
GET    /message-templates
POST   /message-templates
GET    /message-templates/:id
PATCH  /message-templates/:id
DELETE /message-templates/:id

GET    /conversations                        (?page, ?limit, ?contactId, ?status, ?channel)
POST   /conversations
GET    /conversations/:id
PATCH  /conversations/:id                     (status: open|closed)
GET    /conversations/:id/messages
POST   /conversations/:id/messages            (envoie un message sortant réel via EmailProvider/MessagingProvider selon le canal)

GET    /notifications                         (?page, ?limit, ?read) — notifications de l'utilisateur courant uniquement
PATCH  /notifications/:id/read
POST   /notifications/read-all
```

Une `Conversation` est rattachée à un `Contact` et à un canal (`email`, `whatsapp`, `sms`, `internal`). `POST /conversations/:id/messages` accepte soit un `body` libre, soit un `templateId` (le corps/objet du `MessageTemplate` est alors interpolé avec les champs du contact — `{{contact.firstName}}`, `{{contact.lastName}}`, `{{contact.email}}`, `{{contact.phone}}` — et complète tout `body` fourni). L'envoi appelle réellement `EmailProvider`/`MessagingProvider` (voir ci-dessous) et échoue avec `CONTACT_HAS_NO_EMAIL`/`CONTACT_HAS_NO_PHONE` si le contact n'a pas la coordonnée requise pour le canal choisi.

`EmailProvider` (abstraction, voir [architecture.md](architecture.md)) : `ResendEmailProvider` (réel, via l'API REST Resend) si `RESEND_API_KEY` est configuré, sinon `LogEmailProvider` (par défaut — logue l'email au lieu de l'envoyer, comme `ManualPaymentProvider` en Finance). `MessagingProvider` (WhatsApp/SMS) n'a qu'une implémentation `LogMessagingProvider` au MVP — architecture-ready, pas d'intégration WhatsApp Business API réelle (voir section 8 du brief produit).

Une `Notification` est interne à l'organisation (jamais envoyée à un contact) — `POST` n'est volontairement pas exposé publiquement ; elles sont créées uniquement en interne, aujourd'hui via l'action de workflow `internal_notification` (diffusion à tous les membres actifs de l'organisation).

## Analytics

```
GET /analytics/overview
GET /analytics/revenue
GET /analytics/orders
```

## AI

```
POST /ai/chat                                  { conversationId?, agent?, message }
GET  /ai/conversations
GET  /ai/conversations/:id/messages
GET  /ai/conversations/:id/pending-actions
POST /ai/actions/:id/confirm
POST /ai/actions/:id/reject
```

`POST /ai/chat` sans `conversationId` crée une nouvelle conversation (`agent` requis dans ce cas, `general_assistant` par défaut) ; avec `conversationId`, poursuit une conversation existante (le `agent` de la conversation est alors figé, le champ est ignoré). Répond `{ conversationId, reply, pendingActions }` — `pendingActions` liste les tools sensibles (`cancel_booking`) mis en attente de confirmation humaine pendant ce tour, jamais exécutés inline. Voir [ai.md](ai.md) pour le détail de la boucle (tool-calling, permissions, agents, mémoire) et la liste complète des 19 tools MVP.

## Subscriptions

```
GET  /plans                            (catalogue public, tout utilisateur authentifié)
GET  /subscriptions/me                 { subscription, plan, usage }
POST /subscriptions/change-plan        { planKey }  (settings.manage)
```

Chaque organisation reçoit un abonnement `"free"` automatiquement à sa création (voir [ai.md](ai.md) et `docs/IMPLEMENTATION_PLAN.md` Phase 10). `EntitlementsService` est la source de vérité pour trois contrôles réels, tous dérivés du plan actif — jamais codés en dur :
- **Modules** : `PATCH /organizations/me` avec `enabledModules` est rejeté (`403 MODULE_NOT_IN_PLAN`) si un module demandé n'est pas inclus dans le plan actif.
- **Sièges** : `POST /organizations/me/members` est rejeté (`403 SEAT_LIMIT_REACHED`) au-delà de la limite `seats` du plan (comptée en direct sur les memberships, pas un compteur périodique).
- **Usage IA** : `POST /ai/chat` est rejeté (`403 USAGE_LIMIT_REACHED`) au-delà de la limite `ai_messages_per_month` du plan pour la période calendaire en cours ; chaque tour réussi incrémente le compteur.

## API publique (storefront)

Base séparée, ne devant jamais exposer de données internes de l'organisation (uniquement ce qui est publiable : catalogue, disponibilités, création de réservation/commande).

```
GET  /public/:organizationSlug/offers
GET  /public/:organizationSlug/availability
POST /public/:organizationSlug/bookings
POST /public/:organizationSlug/orders
```

## Webhooks (sortants)

Une organisation peut s'abonner à des événements système :
```
booking.created
booking.cancelled
order.created
payment.completed
invoice.paid
customer.created
lead.created
```
Chaque webhook est signé (vérification de signature obligatoire côté récepteur).

## API keys

`api_keys` supporte des clés `test` et `live`. Seul le hash du secret est stocké — jamais le secret en clair (voir [../docs/security.md](security.md), créé en Phase 12 / Hardening).

## Health

```
GET /health
GET /health/database
GET /health/redis
```

Voir aussi [architecture.md](architecture.md) et [multi-tenancy.md](multi-tenancy.md) pour la façon dont `organizationId` est résolu côté serveur (jamais depuis le body).
