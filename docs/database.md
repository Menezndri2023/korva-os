# Database — KORVA OS

## Choix

MongoDB (Atlas-compatible) + Mongoose. Base partagée, collections partagées, isolation par `organizationId` au niveau applicatif (voir [multi-tenancy.md](multi-tenancy.md)).

## Principe tenant-aware

Toute collection contenant des données métier d'une organisation possède un champ `organizationId` obligatoire, jamais fourni par le body utilisateur — toujours dérivé du `TenantContext`.

```json
{
  "_id": "...",
  "organizationId": "...",
  "...": "..."
}
```

## Collections par module (MVP → cible complète)

- **IDENTITY** — `users`, `memberships`, `roles`, `permissions`, `sessions`, `api_keys`
- **ORGANIZATIONS** — `organizations`
- **CRM** — `contacts`, `leads`, `pipelines` (stages embedded as a subdocument array, not a separate collection), `activities`, `tasks`, `notes`, `tags`
- **CATALOG** — `offers` (variants embedded as a subdocument array, pas de collection séparée)
- **CORE** — `custom_fields` (générique, réutilisé par plusieurs modules — voir section Custom fields ci-dessous), `counters` (générateur atomique de numéros séquentiels par organisation — devis, factures, et plus tard commandes)
- **BOOKING** — `resources`, `bookings` (+ disponibilité calculée)
- **COMMERCE** — `carts` (items embarqués, pas de collection `cart_items` séparée), `orders` (lignes embarquées via le même schéma `LineItem` que Quote/Invoice, pas de collection `order_items` séparée), `fulfillments` (pas de collection `shipments` distincte au MVP — architecture-ready, statut de livraison suivi directement sur `fulfillments`)
- **FINANCE** — `quotes`, `invoices`, `payments`, `refunds`
- **WORKFLOW** — `workflows`, `workflow_executions`
- **COMMUNICATION** — `conversations`, `messages`, `message_templates`, `notifications`
- **SUBSCRIPTIONS** — `plans`, `subscriptions`, `subscription_items`, `usage`
- **FILES** — métadonnées fichiers (tenant-aware)
- **AUDIT** — `audit_logs`
- **API/WEBHOOKS** — `webhooks`, `api_keys`
- **DOMAINS** — `custom_domains`

## Index obligatoires

Toute collection tenant-aware :

```
{ organizationId: 1 }
```

Exemples spécifiques (à affiner après analyse réelle des requêtes en Phase 1+) :

```
contacts:   { organizationId: 1, email: 1 }
leads:      { organizationId: 1, status: 1, createdAt: -1 }
bookings:   { organizationId: 1, resourceId: 1, startAt: 1 }
orders:     { organizationId: 1, status: 1, createdAt: -1 }
```

## Modèles clés (résumé)

**Organization**
```
{ name, slug, legalName, type, country, currency, timezone, language, logo, settings, enabledModules, createdAt, updatedAt }
```

**Membership**
```
{ userId, organizationId, roleId, status }
```

**Contact**
```
{ organizationId, type, firstName, lastName, email, phone, company, tags, customFields, createdAt, updatedAt }
```

**Lead**
```
{ organizationId, contactId, source, pipelineId, stageId, ownerId, status, estimatedValue, probability, customFields, createdAt, updatedAt }
```

**Offer**
```
{ organizationId, type, name, description, images, categories, pricing: { amount, currency, taxRate }, sku, variants: [{ name, sku, priceOverride }], status, customFields }
```

**Resource**
```
{ organizationId, name, type, capacity, description, active, weeklyAvailability: [{ dayOfWeek, startTime, endTime }], blockedSlots: [{ startAt, endAt, reason }] }
```
`type` est libre (personne, véhicule, salle, équipement, ...) — jamais un enum fermé propre à un secteur.

**Booking**
```
{ organizationId, resourceId, offerId, contactId, startAt, endAt, status, pricing: { amount, currency }, paymentStatus, notes }
```
`contactId` (et non `customerId`) pour rester cohérent avec CRM/Finance qui référencent tous la même collection `contacts`.

**Quote**
```
{ organizationId, contactId, number, status, items: [{ offerId?, description, quantity, unitPrice, taxRate }], currency, subtotal, taxTotal, total, validUntil, notes }
```
`subtotal`/`taxTotal`/`total` sont toujours recalculés côté serveur à partir de `items` — jamais acceptés depuis le client.

**Invoice**
```
{ organizationId, contactId, quoteId?, number, status, items: [...], currency, subtotal, taxTotal, total, amountPaid, dueDate, issuedAt, notes }
```

**Payment**
```
{ organizationId, invoiceId, amount, currency, status, provider, providerReference, method, createdAt }
```

**Refund**
```
{ organizationId, paymentId, amount, reason, createdAt }
```

**Cart**
```
{ organizationId, contactId, status, items: [{ offerId, quantity }] }
```
Le prix n'est pas figé dans le panier (contrairement aux lignes de commande) — il est résolu depuis l'Offer au moment du `checkout`, pour toujours refléter le prix courant.

**Order** (Order Engine unifié — voir `docs/architecture.md`)
```
{ organizationId, contactId, number, status, source: "cart"|"booking"|"manual", bookingId?, invoiceId?, items: [...], currency, subtotal, taxTotal, total, notes }
```
`items` réutilise le même schéma `LineItem` que Quote/Invoice (`apps/api/src/shared/line-item.schema.ts`), partagé entre Finance et Commerce.

**Fulfillment**
```
{ organizationId, orderId, status, carrier, trackingNumber, shippedAt, deliveredAt }
```

**Workflow**
```
{ organizationId, name, trigger, active, conditions: [{ field, operator, value }], actions: [{ type, config }], createdAt, updatedAt }
```
`conditions`/`actions` sont des sous-documents embarqués (`_id: false`), pas de collections séparées. `trigger` référence un [événement système](api.md#event-bus--événements-système) ; `actions[].type` est `create_task`|`send_email`|`webhook`, `config` variant selon le type (union discriminée, voir `packages/types/src/workflow.ts`).

**WorkflowExecution**
```
{ organizationId, workflowId, eventName, payload, status: "success"|"failed", actionResults: [{ type, success, error? }], error?, createdAt }
```
Une exécution est enregistrée uniquement quand les `conditions` du workflow ont matché le payload de l'événement (sinon rien n'est journalisé). `status` est `"failed"` si au moins une action a échoué — les autres actions du même workflow s'exécutent quand même (pas d'interruption en cascade).

**Audit log**
```
{ organizationId, userId, action, entity, entityId, metadata, createdAt }
```

## Custom fields

Table `custom_fields` générique, applicable à `contacts`, `leads`, `offers`, `bookings`, `orders` :

```
{ organizationId, entity, key, label, type, options, required }
```

Types supportés : `text, number, boolean, date, datetime, select, multiselect, email, phone, url`.

## Migrations / seeders

Pas de migrations SQL classiques (MongoDB), mais des scripts de seed versionnés dans `infrastructure/scripts/` pour :
- données de développement (voir section Seed du brief produit — organisation "KORVA Demo", 3 scénarios : service, booking, ecommerce)
- changements de schéma nécessitant une transformation de données existantes (scripts idempotents, exécutés manuellement ou via job).
