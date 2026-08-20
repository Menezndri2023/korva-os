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
GET    /offers
POST   /offers
GET    /offers/:id
PATCH  /offers/:id
DELETE /offers/:id
```

## Booking

```
GET  /availability
POST /bookings
GET  /bookings/:id
PATCH /bookings/:id
POST /bookings/:id/cancel
```

## Commerce

```
GET  /products
POST /cart
POST /checkout
POST /orders
GET  /orders/:id
```

## Finance

```
GET  /quotes
POST /quotes
GET  /invoices
POST /invoices
POST /payments
```

## Workflow

```
GET   /workflows
POST  /workflows
PATCH /workflows/:id
POST  /workflows/:id/test
```

## Analytics

```
GET /analytics/overview
GET /analytics/revenue
GET /analytics/orders
```

## AI

```
POST /ai/chat
GET  /ai/conversations
POST /ai/actions/:id/confirm
```

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
