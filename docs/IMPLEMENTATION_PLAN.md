# KORVA OS — Implementation Plan

Statut : PHASE 1 (Foundation) à PHASE 6 (Commerce) terminées et validées — voir sections 9-15. PHASE 7 (Workflow) non démarrée.
Dernière mise à jour : 2026-08-20

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

## 10. Statut PHASE 2 (CRM) — terminée

Livré et validé (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo, plus vérification manuelle via curl et via le serveur de dev Next.js) :

- **Custom Fields Engine** (générique, réutilisable par Catalog/Booking/Commerce plus tard) : CRUD `/custom-fields`, validation stricte des valeurs (clé inconnue rejetée, type vérifié, champs requis appliqués) branchée sur Contacts et Leads.
- **Contacts** : CRUD complet, recherche plein texte (index Mongo `text`), filtre par tag, tags, custom fields.
- **Tags** : CRUD simple, unicité par organisation.
- **Pipelines** : CRUD avec étapes embarquées (subdocuments), un seul pipeline `isDefault` par organisation appliqué automatiquement.
- **Leads** : CRUD, référence validée vers un contact existant et vers une étape réelle du pipeline choisi, changement de statut/étape.
- **Activities, Tasks, Notes** : CRUD de base rattaché à un contact ou un lead.
- **Frontend** : `/dashboard/crm` (liste + création de contacts, recherche, tags) et `/dashboard/crm/leads` (liste + création de leads, sélection pipeline/étape/contact, création d'un pipeline par défaut si aucun n'existe).
- **Tests** : `apps/api/test/crm.e2e-spec.ts` — validation des custom fields, CRUD contacts, cycle de vie lead à travers un pipeline, isolation tenant sur les contacts (24/24 tests e2e stables, exécution forcée en séquentiel — voir ADR-003).

Un bug de fiabilité des tests a été trouvé et corrigé en cours de route (ADR-003 dans `docs/architecture-decisions.md`) : les fichiers e2e partageaient une base MongoDB de test unique et s'exécutaient en parallèle par défaut, provoquant des échecs non déterministes.

Non fait volontairement en Phase 2 (hors scope) : import/export CSV des contacts, vue kanban drag-and-drop du pipeline, endpoint de listing des rôles (nécessaire pour un vrai sélecteur de rôle dans l'UI d'invitation), notifications de relance automatiques (arrive avec Workflow en Phase 7).

## 11. Statut PHASE 3 (Catalog) — terminée

Livré et validé (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo, plus vérification manuelle via curl) :

- **Entité générique Offer** : les 6 types (`product`, `service`, `booking`, `digital_product`, `subscription`, `package`) partagent un seul modèle — pricing (montant, devise, taux de taxe), catégories (tags libres), variantes embarquées (chacune avec son propre id), SKU, statut (`draft`/`active`/`archived`).
- **CRUD complet** `/offers` : recherche plein texte (index Mongo `text` sur nom/description/SKU), filtres par type/statut/catégorie, pagination.
- **Custom Fields** : nouvelle entité `offers` ajoutée au moteur générique (remplace les entités `products`/`services` du brief d'origine, incompatibles avec le modèle Offer unifié — voir le commentaire dans `packages/types/src/custom-fields.ts`) ; validation stricte réutilisée telle quelle.
- **RBAC** : permissions `offers.read/create/update/delete` ajoutées à `packages/types/src/rbac.ts` (absentes du brief d'origine) et distribuées aux rôles système (OWNER/ADMIN: tout, MANAGER: read/create/update, SALES/FINANCE/STAFF: read seul).
- **Frontend** : `/dashboard/catalog` — liste filtrable par type, création d'offre (nom, type, SKU, description, prix/devise).
- **Tests** : `apps/api/test/catalog.e2e-spec.ts` — validation custom fields, CRUD avec variantes (ids assignés), filtre par type, recherche plein texte, isolation tenant.

Un deuxième bug de fiabilité des tests e2e a été trouvé et corrigé pendant cette phase (complète l'ADR-003) : même avec `maxWorkers: 1`, les 4 fichiers e2e tournant dans le même processus Node pouvaient se réutiliser des sockets HTTP keep-alive entre applications NestJS différentes, produisant des réponses corrompues de façon intermittente — fixé en désactivant `http.globalAgent.keepAlive` dans `env.setup.ts`. 4 exécutions complètes consécutives à 30/30 tests stables après le correctif.

Non fait volontairement en Phase 3 (hors scope, arrive avec les modules concernés) : upload réel d'images (StorageProvider arrive en Phase "Files"), taxonomie de catégories structurée (actuellement des tags libres, cohérent avec le choix fait pour les tags CRM), gestion de stock/inventaire (Commerce, Phase 6).

## 12. Statut PHASE 4 (Finance) — terminée

Livré et validé (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo, plus vérification manuelle via curl du cycle complet devis → facture → paiement partiel/total → remboursement partiel/total) :

- **Quotes** : cycle de vie complet `draft → sent → accepted/rejected`, numérotation séquentielle atomique par organisation (`DEV-0001`), lignes éditables uniquement en `draft`, conversion en facture (`accepted → Invoice`).
- **Invoices** : `draft → issued → partially_paid/paid`, numérotation séquentielle (`FAC-0001`), `amountPaid`/statut recalculés automatiquement à chaque paiement ou remboursement, `cancel`.
- **Totaux toujours recalculés côté serveur** à partir des lignes (`subtotal`/`taxTotal`/`total`) — jamais acceptés depuis le client, testé explicitement en e2e.
- **Payments/Refunds** : paiements partiels et multiples supportés, refus si le montant dépasse le solde restant ; remboursements partiels et multiples supportés, refus si le montant dépasse le solde remboursable.
- **Abstraction `PaymentProvider`** (`createPayment`/`verifyPayment`/`getPaymentStatus`/`refundPayment`) — le domaine métier ne connaît jamais un fournisseur concret. Provider par défaut du MVP : `ManualPaymentProvider` (encaissement enregistré manuellement — espèces, virement), injecté via le token `PAYMENT_PROVIDER`. Stripe/CinetPay/Paystack/Flutterwave pourront être ajoutés plus tard en implémentant la même interface, sans toucher aux services métier.
- **`CountersService`** générique (`apps/api/src/core/counters/`) : génération atomique de numéros séquentiels par organisation, réutilisable pour les futures commandes (Phase 6).
- **RBAC** : permissions manquantes du brief ajoutées (`quotes.read`, `quotes.update`, `invoices.update`, `payments.create`) et distribuées aux rôles système.
- **Frontend** : `/dashboard/finance` (devis — création multi-lignes, envoi, acceptation, conversion) et `/dashboard/finance/invoices` (factures — émission, encaissement).
- **Tests** : `apps/api/test/finance.e2e-spec.ts` — recalcul serveur des totaux, transitions de statut valides/invalides, paiements/remboursements partiels et dépassement de solde, isolation tenant. 42/42 tests e2e stables sur 3 exécutions consécutives.

Non fait volontairement en Phase 4 (hors scope, arrive avec les modules concernés) : génération de PDF pour devis/factures (Phase Workflow/Communication), envoi automatique par email (Phase 8), intégration réelle d'un fournisseur de paiement en ligne (l'abstraction est prête, aucune clé API configurée), relances automatiques sur factures en retard (Phase 7 Workflow).

## 13. Statut PHASE 5 (Booking) — terminée

Livré et validé (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo, plus vérification manuelle via curl : horaires hebdomadaires, chevauchement, capacité multiple, créneaux bloqués, reprogrammation, annulation) :

- **Resources** génériques (`type` libre — personne, véhicule, salle, équipement... jamais un enum fermé propre à un secteur), avec horaires hebdomadaires récurrents (`weeklyAvailability`) et créneaux bloqués ponctuels (`blockedSlots`, ajout/suppression individuels).
- **AvailabilityService** : moteur central de vérification — resource active, dans les horaires hebdomadaires, hors créneaux bloqués, sous la capacité (réservations actives qui se chevauchent comptées et comparées à `capacity`). Un seul point de vérité utilisé à la fois par la création et la reprogrammation d'une réservation.
- **`GET /availability`** : vue jour pour une ressource (horaires du jour, réservations existantes, créneaux bloqués) — pensée pour alimenter un calendrier côté frontend.
- **Bookings** : création (prix copié depuis l'offre au moment de la réservation, comme un instantané), reprogrammation (re-vérifie la disponibilité en excluant la réservation elle-même), annulation (idempotence refusée — une réservation déjà annulée ne peut pas l'être une seconde fois).
- **RBAC** : permission manquante du brief ajoutée (`bookings.update`, nécessaire pour la reprogrammation) et distribuée aux rôles système. Les ressources sont gérées sous `settings.manage` (tâche de configuration), leur lecture sous `bookings.read`.
- **Frontend** : `/dashboard/bookings` (réservations — création avec sélection ressource/offre/client/date/heure, aperçu de la disponibilité du jour, annulation) et `/dashboard/bookings/resources` (ressources — création avec constructeur d'horaires hebdomadaires).
- **Tests** : `apps/api/test/booking.e2e-spec.ts` — horaires respectés/rejetés, chevauchement rejeté puis autorisé après annulation, capacité multiple, créneaux bloqués, reprogrammation, isolation tenant. 53/53 tests e2e stables sur 3 exécutions consécutives.

**Limitation connue documentée** (ADR-004) : la disponibilité est calculée en UTC brut, pas dans le fuseau horaire de l'organisation (`Organization.timezone` existe mais n'est pas encore utilisé pour cette conversion) — acceptable pour valider le moteur de réservation lui-même en MVP, à corriger avant un usage production réel avec des organisations hors UTC.

Non fait volontairement en Phase 5 (hors scope, arrive avec les modules concernés) : conversion de fuseau horaire (voir ADR-004), acompte/paiement de réservation intégré à Finance (le champ `paymentStatus` existe mais n'est pas encore relié à un vrai paiement — arrivera avec l'Order Engine unifié de la Phase 6), notifications de confirmation/rappel (Phase 8 Communication), vue calendrier visuelle riche côté frontend (l'aperçu du jour actuel est fonctionnel mais minimal).

## 14. Statut PHASE 6 (Commerce) — terminée

Livré et validé (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo, plus vérification manuelle via curl du cycle complet panier → commande → facture → livraison, et du cycle réservation → commande) :

- **Order Engine unifié** (section 18 du brief) : une seule entité `Order` alimentée par trois sources (`cart`, `booking`, `manual`), toutes convergeant vers les mêmes actions (`confirm`, `cancel`, `fulfill`, `generate-invoice`). `Order.items` réutilise littéralement le schéma `LineItem` partagé avec Quote/Invoice (déplacé de `finance/shared/` vers `apps/api/src/shared/` pour refléter qu'il est désormais utilisé par Finance ET Commerce).
- **Carts** : items non figés en prix (résolu depuis l'Offer au checkout, contrairement aux lignes de commande qui sont un instantané), incrémentation automatique en cas d'ajout du même article, `checkout` marque le panier `converted` et empêche une seconde conversion.
- **Orders** : `pending → confirmed → fulfilled`, `cancel` depuis `pending`/`confirmed` uniquement, `generate-invoice` refuse une commande déjà facturée ou non confirmée, `from-booking` refuse de créer une deuxième commande pour la même réservation.
- **`InvoicesService.createFromOrder`** ajouté (généralise le pattern déjà utilisé par `createFromQuote` en Phase 4 — `Invoice.orderId` complète `Invoice.quoteId`), sans rien casser du flux Quote → Invoice existant.
- **Fulfillments** : architecture-ready (statut `pending/shipped/delivered/cancelled`, transporteur, numéro de suivi) — créé automatiquement quand une commande est livrée, sans intégration transporteur réelle.
- **RBAC** : permissions `orders.*` ajoutées (absentes du brief) et distribuées aux rôles système.
- **Frontend** : `/dashboard/orders` (liste, création manuelle multi-lignes, confirmer/facturer/livrer/annuler).
- **Tests** : `apps/api/test/commerce.e2e-spec.ts` — panier → commande avec totaux recalculés côté serveur, cycle de vie complet d'une commande, réservation → commande (avec refus de doublon), isolation tenant. 63/63 tests e2e stables sur 3 exécutions consécutives.

Non fait volontairement en Phase 6 (hors scope, arrive avec les modules concernés) : intégration transporteur réelle pour Fulfillment (Stripe Shipping/autre — architecture-ready seulement), panier public pour un client non authentifié (arrive avec le Storefront en Phase 11, l'API `/carts` actuelle est pensée pour être directement réutilisable par l'API publique de cette phase), gestion de stock/inventaire sur les Offers.

## 15. Statut PHASE 7 (Workflow) — terminée

Livré et validé (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo — 71/71 tests e2e stables sur 3 exécutions consécutives, plus vérification manuelle via curl du cycle complet workflow → événement → exécution asynchrone → tâche créée, contre les serveurs de dev réels avec Redis/Mongo) :

- **EventBus** (`apps/api/src/core/events/`, module `@Global()`) : `EventBusService.publish(organizationId, name, payload)` pousse un job sur une queue BullMQ/Redis (`events`) sans jamais bloquer ni faire échouer la requête HTTP qui l'émet (erreur de publication loguée, pas propagée). Câblé dans les 6 services métier qui publient déjà des événements : `ContactsService` (`customer.created`), `LeadsService` (`lead.created`), `QuotesService` (`quote.created`, `quote.accepted`), `OrdersService` (`order.created`), `PaymentsService` (`payment.completed`), `BookingsService` (`booking.created`, `booking.cancelled`).
- **Workflow Engine** (`apps/api/src/workflow/`) : `EventsProcessor` (Worker BullMQ) consomme la queue `events` et appelle `WorkflowEngineService.handleEvent()`, qui retrouve les workflows actifs déclenchés par ce nom d'événement, évalue leurs `conditions` (AND, dot-path dans le payload, opérateurs `equals`/`not_equals`/`greater_than`/`less_than`/`contains`), exécute leurs `actions` (`create_task` — réel via `TasksService`, `send_email` — stub en attendant l'`EmailProvider` de la Phase 8, `webhook` — POST HTTP réel), puis journalise le résultat dans `workflow_executions` (uniquement si les conditions ont matché — sinon rien n'est journalisé).
- **Interpolation de templates** (`{{field}}`/`{{a.b}}`) dans les configs d'action (titre de tâche, sujet/corps d'email) résolues depuis le payload de l'événement.
- **CRUD + dry-run** : `GET/POST/PATCH/DELETE /workflows`, `GET /workflows/:id/executions`, `POST /workflows/:id/test` (évalue les conditions sur un payload donné sans exécuter d'action, pour tester un workflow avant activation).
- **RBAC** : permissions `workflows.read/create/update/delete` ajoutées.
- **Frontend** : `/dashboard/workflows` (liste, création avec sélecteur de déclencheur + constructeur de conditions + constructeur d'actions selon le type choisi, activation/désactivation, test à blanc, historique des exécutions, suppression).
- **Tests** : `apps/api/test/workflow.e2e-spec.ts` — CRUD, dry-run, isolation tenant, et un test bout-en-bout qui déclenche un vrai événement (création d'un lead) et attend (poll) que le worker BullMQ asynchrone traite l'événement et crée réellement la tâche attendue, tout en vérifiant qu'un second workflow dont les conditions ne matchent pas ne produit aucun effet.

Décisions notables documentées en ADR : [ADR-005](architecture-decisions.md#adr-005--eventsprocessor-worker-bullmq-du-workflow-engine-colocalisé-dans-appsapi-pas-dans-appsworker) (le Worker BullMQ tourne dans `apps/api`, pas `apps/worker`, pour réutiliser directement les services Nest existants comme `TasksService`) et [ADR-006](architecture-decisions.md#adr-006--propp-type-string--explicite-requis-sur-tout-champ-mongoose-dont-le-type-typescript-est-une-union-de-littéraux) (piège `@nestjs/mongoose` sur les champs Mongoose typés en union de littéraux — invisible au typecheck/build, révélé seulement au boot réel de l'app).

Non fait volontairement en Phase 7 (hors scope, arrive avec les modules concernés) : envoi d'email réel pour l'action `send_email` (stub en attendant l'`EmailProvider` de la Phase 8 Communication), `quote.expired`/`invoice.overdue` comme déclencheurs réellement émis (nécessitent un scheduler/cron, pas encore construit), abonnement à des webhooks sortants par organisation (différent de l'action `webhook` d'un workflow — prévu section "Webhooks (sortants)" de `docs/api.md`, Phase Hardening/API publique).

## 16. Prochaine étape

Démarrer PHASE 8 (Communication) : conversations, messages, templates, notifications, `MessagingProvider`/`EmailProvider` réels — en s'appuyant sur l'EventBus et le Workflow Engine déjà en place (l'action `send_email` d'un workflow passera de stub à réelle dès que l'`EmailProvider` existera).
