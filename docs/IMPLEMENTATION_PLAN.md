# KORVA OS — Implementation Plan

Statut : PHASE 1 (Foundation) à PHASE 12 (Hardening) terminées et validées — voir sections 9-20, les 12 phases du MVP sont closes. Travaux post-MVP (scheduler de réconciliation BullMQ, Lots Q/R/S/T de fiabilisation et de password reset) réalisés depuis — voir section 21.
Dernière mise à jour : 2026-08-22

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

## 16. Statut PHASE 8 (Communication) — terminée

Livré et validé (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo — 83/83 tests e2e stables sur 8 exécutions consécutives, plus vérification manuelle via curl du cycle complet modèle → conversation → message envoyé, et workflow → notification interne, contre les serveurs de dev réels) :

- **`EmailProvider`** (`apps/api/src/communication/providers/`) : abstraction réelle, deux implémentations — `ResendEmailProvider` (appelle l'API REST Resend via `fetch`, utilisée si `RESEND_API_KEY` est configuré) et `LogEmailProvider` (par défaut, logue l'email au lieu de l'envoyer — même rôle que `ManualPaymentProvider` en Finance : fonctionne sans clé live). Sélection automatique via une factory dans `CommunicationModule` selon `EMAIL_PROVIDER`/`RESEND_API_KEY`.
- **`MessagingProvider`** : abstraction posée pour WhatsApp/SMS, seule implémentation `LogMessagingProvider` (architecture-ready, pas d'intégration WhatsApp Business API réelle — hors scope MVP conformément au brief).
- **Message Templates** : CRUD, corps/objet interpolés (`{{contact.firstName}}` etc., réutilise `interpolate()` déplacé de `workflow/` vers `apps/api/src/shared/template.ts` puisque désormais partagé).
- **Conversations & Messages** : une conversation est rattachée à un contact + un canal (`email`/`whatsapp`/`sms`/`internal`) ; l'envoi d'un message appelle réellement `EmailProvider`/`MessagingProvider` selon le canal (ou aucun pour `internal`), refuse si le contact n'a pas l'email/téléphone requis, refuse sur une conversation fermée. `messages` est une collection séparée de `conversations` (contrairement aux lignes de devis/commande) car non bornée et requêtée indépendamment.
- **Notifications internes** : jamais exposées en création publique — créées uniquement en interne via `NotificationsService.notifyOrganization()`, aujourd'hui appelée par la nouvelle action de workflow `internal_notification` (4ᵉ type d'action, en plus de `create_task`/`send_email`/`webhook`) qui diffuse à tous les membres actifs de l'organisation. `WorkflowActionsService.sendEmail()` utilise maintenant le vrai `EmailProvider` au lieu du stub-log de la Phase 7.
- **RBAC** : permissions `conversations.*`, `message_templates.*`, `notifications.read/update` ajoutées et distribuées aux rôles système.
- **Frontend** : `/dashboard/communication` (conversations — création, fil de messages, envoi avec ou sans modèle, ouverture/fermeture), `/dashboard/communication/templates` (CRUD), `/dashboard/communication/notifications` (liste, marquer comme lu/tout lu) ; `/dashboard/workflows` étendu pour construire une action `internal_notification`.
- **Tests** : `apps/api/test/communication.e2e-spec.ts` — CRUD des modèles, cycle complet conversation/message sur le canal email (y compris interpolation de modèle et rejets `CONTACT_HAS_NO_EMAIL`/`CONVERSATION_CLOSED`), un test bout-en-bout déclenchant un vrai événement (`customer.created`) et attendant que le Workflow Engine asynchrone crée réellement la notification, isolation tenant.

Deux bugs trouvés et corrigés en cours de route, documentés en ADR : [ADR-007](architecture-decisions.md#adr-007--ne-jamais-appeler-tostring-sur-un-champ-objectid-populé-via-populate-sans-vérifier-quil-nest-plus-populé) (`.toString()` sur un champ `ObjectId` populé via `.populate()` ne redonne pas l'id — cassait silencieusement la diffusion des notifications) et [ADR-008](architecture-decisions.md#adr-008--toujours-arrêter-les-serveurs-de-dev-lancés-pour-un-smoke-test-manuel-avant-de-relancer-la-suite-e2e) (un serveur de dev resté actif après un smoke test manuel se dispute silencieusement les jobs BullMQ avec la suite e2e, puisqu'ils partagent le même Redis — conséquence directe du choix d'architecture de l'ADR-005).

Non fait volontairement en Phase 8 (hors scope, arrive avec les modules concernés) : intégration WhatsApp Business API réelle (abstraction posée, pas de clé/API réelle), templates avec pièces jointes, envoi en masse/campagnes (Marketing n'est pas un module du MVP), messages entrants réels (webhooks entrants pour recevoir des emails/WhatsApp — l'architecture le permettrait via `direction: "inbound"` mais aucun endpoint de réception n'existe encore), badge de notifications non lues dans la sidebar (la page `/dashboard/communication/notifications` existe et fonctionne, l'intégration visuelle globale à la sidebar est un raffinement UI reporté).

## 17. Statut PHASE 9 (AI) — terminée

Livré et validé (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo — 92/92 tests e2e stables sur la grande majorité des exécutions complètes, voir addendum Phase 9 de l'ADR-003 ; plus vérification manuelle via curl du cycle complet chat → notification "IA non configurée" contre le serveur de dev réel, sans clé Anthropic) :

- **`AIProvider`** (`apps/api/src/ai/providers/`) : `AnthropicAIProvider` (appel réel à l'API Messages d'Anthropic, tool-calling natif) si `AI_API_KEY` est configuré, sinon `NullAIProvider` par défaut (réponse fixe, aucun tool jamais appelé — même rôle que `LogEmailProvider`/`ManualPaymentProvider`).
- **Orchestrateur** (`AiOrchestratorService`) : boucle complète (jusqu'à 5 itérations) — appel modèle → exécution des tools demandés (permission métier + permission d'agent vérifiées) → résultat réinjecté dans l'historique → nouvel appel modèle, jusqu'à une réponse texte finale. Historique persisté (`ai_conversations`/`ai_messages`), rejoué intégralement à chaque tour.
- **19 tools MVP**, chacun un wrapper fin sur un service métier déjà construit dans une phase précédente (jamais d'accès Mongo direct, sauf `get_sales_report` qui fait une agrégation Mongo réelle et minimale sur `orders`, scopée à l'IA — pas de module Analytics complet, hors phase numérotée du brief).
- **4 agents** avec sous-ensembles de tools distincts (`AiToolsRegistryService`), filtrés en plus par les permissions RBAC réelles de l'utilisateur appelant.
- **Confirmation humaine pour actions sensibles** : seul `cancel_booking` est marqué sensible dans ce MVP (les 5 tools nommés dans le brief pour ce mécanisme — `refund_payment`, `delete_customer`, etc. — n'existent pas comme tools) ; `AiPendingAction` créée au lieu d'exécuter, `POST /ai/actions/:id/confirm`/`reject`.
- **RBAC** : `ai.use`/`ai.execute_sensitive_actions` existaient déjà depuis la Phase 1 — confirmés directement exploitables sans modification.
- **Frontend** : `/dashboard/ai` — sélection d'agent, liste de conversations, fil de messages avec indicateurs d'appel de tool, cartes de confirmation pour les actions en attente.
- **Tests** : `apps/api/test/ai.e2e-spec.ts` — un `AIProvider` scripté injecté via `.overrideProvider(AI_PROVIDER)` (décide quel tool appeler d'après le seul historique de messages, sans jamais appeler un vrai LLM) exerçant pour de vrai toute la boucle orchestrateur ; plus un test séparé du chemin par défaut `NullAIProvider`.

Ajustement de câblage trouvé en cours de route (pas un ADR à part entière) : `LeadsService`, `AvailabilityService`, `QuotesService`, `OrdersService`, `ConversationsService` manquaient dans les `exports:` de leurs modules respectifs (jamais consommés depuis un autre module jusqu'ici) — corrigé.

Non fait volontairement en Phase 9 (hors scope, cohérent avec "architecture-ready" du brief) : RAG (aucune source de documents/vector store à ce stade), `MessagingProvider` WhatsApp réel, `EntitlementService`/quotas sur l'usage IA (arrive avec la Phase 10 Subscriptions), les tools `refund_payment`/`delete_customer`/`delete_order`/`send_mass_campaign`, agents `SUPPORT_AGENT`/`COMMERCE_AGENT`/`OPERATIONS_AGENT`/`MARKETING_AGENT` (prévus "futurs" dans le brief).

## 18. Statut PHASE 10 (SaaS) — terminée

Livré et validé (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo — 99/99 tests e2e stables sur la grande majorité des exécutions complètes, voir ADR-003 ; plus vérification manuelle via curl du cycle complet organisation → abonnement "free" → changement de plan → quota IA contre le serveur de dev réel) :

- **Catalogue de plans** (`apps/api/src/subscriptions/`) : 4 plans (`free`/`starter`/`pro`/`business`), semés paresseusement au premier accès plutôt qu'au boot de l'app (voir [ADR-009](architecture-decisions.md#adr-009--ne-jamais-compter-sur-onmoduleinit-pour-semer-des-données-qui-doivent-survivre-à-connectiondropdatabase) — un hook `OnModuleInit` semblait correct mais se faisait effacer par le `dropDatabase()` de chaque fichier e2e, cassant 88 tests d'un coup). `"free"` est délibérément généreux (tous les modules) pour ne jamais casser l'onboarding existant ; `"starter"` exclut `workflow`/`ai` pour démontrer une restriction de palier réelle.
- **Abonnement automatique** : chaque nouvelle organisation reçoit un `Subscription` sur le plan `"free"` (`SubscriptionsService.createDefaultSubscription`, appelé depuis `OrganizationsService.createForOwner`). Pas d'intégration de facturation réelle (Stripe Billing etc.) — changer de plan (`POST /subscriptions/change-plan`) est un changement instantané et gratuit au MVP, cohérent avec `PaymentProvider` qui n'a lui non plus aucune clé live configurée.
- **`EntitlementsService`** : source de vérité pour trois contrôles réels, tous branchés à des points d'intégration existants plutôt que via un retrofit large de tous les guards (choix délibéré pour ne casser aucun des 92 tests e2e déjà stables) :
  - Modules : `OrganizationsService.update()` rejette (`403 MODULE_NOT_IN_PLAN`) tout `enabledModules` contenant un module hors du plan actif.
  - Sièges : `OrganizationsService.addMember()` rejette (`403 SEAT_LIMIT_REACHED`) au-delà de la limite `seats` du plan (comptage en direct des memberships, pas un compteur périodique).
  - Usage IA : `AiOrchestratorService.chat()` rejette (`403 USAGE_LIMIT_REACHED`) au-delà de `ai_messages_per_month`, comptée par mois calendaire — ferme la promesse laissée ouverte en Phase 9.
- **RBAC** : aucun changement — `ai.use`/`ai.execute_sensitive_actions` (posés en Phase 1) suffisaient déjà, `EntitlementsService` est un contrôle orthogonal (quota/plan), pas un remplacement des permissions de rôle.
- **Frontend** : section "Abonnement" ajoutée à `/dashboard/settings` — plan actuel, barres d'usage, sélecteur de plan.
- **Tests** : `apps/api/test/subscriptions.e2e-spec.ts` — catalogue de plans, abonnement par défaut, gate de modules après changement de plan, refus d'un non-OWNER à changer de plan, limite de sièges (invitation refusée au-delà de 3 membres), quota IA (5 messages acceptés puis le 6ᵉ refusé), isolation tenant.

Non fait volontairement en Phase 10 (hors scope, cohérent avec le MVP) : intégration de facturation réelle (Stripe Billing/webhooks — aucun `PaymentProvider` de facturation récurrente, distinct du `PaymentProvider` ponctuel de la Phase 4 Finance), essais gratuits (`trialing`)/factures impayées (`past_due`) — seuls `active`/`canceled` existent, `CRUD` de plans par API (le catalogue n'est modifiable qu'en code, pas de `POST/PATCH /plans`), rétrofit du gate de module sur les routes API existantes (le gate ne s'applique qu'à l'activation d'un module via `PATCH /organizations/me`, pas à chaque requête vers ce module — un org sur un plan restrictif qui a déjà activé un module gardera l'accès tant qu'elle ne tente pas de le réactiver après un changement de plan).

## 19. Statut PHASE 11 (Storefront) — terminée

Livré et validé (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo — 109/109 tests e2e stables sur la grande majorité des exécutions complètes ; plus vérification manuelle contre les serveurs de dev réels : organisation → offres/ressources publiques → commande → réservation, sans aucune authentification) :

- **API publique** (`apps/api/src/public/`) : contrôleur `@Public()` monté sur `/public/:organizationSlug`, `organizationId` résolu depuis le slug (jamais depuis un header ou un body — voir `docs/multi-tenancy.md`) et revérifié à chaque appel. Chaque route vérifie que le module concerné est dans `enabledModules` avant de répondre (`404 MODULE_NOT_AVAILABLE`, jamais `403`, pour ne pas laisser deviner l'existence d'un module désactivé).
- **Contact anonyme** : `ContactsService.findOrCreateByEmail` (nouveau) fait correspondre un visiteur à un `Contact` existant par email ou en crée un — `ContactsService.create`, `BookingsService.create` et `OrdersService`'s `createOrderRecord` acceptent désormais un `userId` optionnel (`undefined` pour toute action publique, l'audit log omet simplement l'acteur plutôt que d'inventer un utilisateur système).
- **`OrdersService.createFromStorefront`** (nouveau, `source: "storefront"` ajouté à `ORDER_SOURCES`) : les lignes de commande sont toujours reconstruites côté serveur depuis l'`Offer` réel (description, prix, taxe) — le client public n'envoie jamais de prix, seulement `{offerId, quantity}`.
- **`ResourcesService`** ajouté aux `exports:` de `BookingModule` (non exporté jusqu'ici, personne n'en avait eu besoin depuis un autre module) — même pattern d'ajustement au fil des besoins qu'en Phase 9.
- **Frontend `apps/storefront`** : routage MVP par chemin (`/:organizationSlug`, pas de sous-domaine — voir `docs/architecture.md`), une page unique par organisation avec catalogue, réservation (sélection ressource/date/heure/durée — les `Offer` n'ayant pas de durée propre, la durée est choisie côté visiteur parmi des créneaux fixes) et panier/checkout pour les offres non-réservables.
- **Tests** : `apps/api/test/public.e2e-spec.ts` — catalogue public (offres `draft` masquées), commande publique avec prix recalculé, réutilisation du contact sur une deuxième commande, offre inexistante, gate de module, organisation inconnue, réservation publique, liste de ressources.

Un bug d'infrastructure de test important a été découvert et corrigé pendant cette phase — pas un bug applicatif mais un correctif à la méthodologie de vérification elle-même, documenté en addendum de l'[ADR-008](architecture-decisions.md#adr-008--toujours-arrêter-les-serveurs-de-dev-lancés-pour-un-smoke-test-manuel-avant-de-relancer-la-suite-e2e) : `lsof -ti :4000 | xargs kill` ne tue que le détenteur *actuel* du port, pas les process `nest start --watch` zombies accumulés au fil des phases (échec `EADDRINUSE` silencieux, Worker BullMQ resté actif) — quatre s'étaient accumulés sur cette session et expliquaient une bonne partie de la flakiness attribuée à tort à la seule taille croissante de la suite dans l'addendum Phase 9. `pkill -9 -f "nest.js start --watch"` est désormais la méthode de nettoyage systématique.

Non fait volontairement en Phase 11 (hors scope, cohérent avec "architecture-ready" du brief) : routage par sous-domaine/domaines personnalisés (middleware de résolution d'hôte non construit, routage par chemin utilisé à la place), panier serveur multi-étapes pour la vue publique (le panier vit côté client jusqu'à la commande — `POST /orders` est un achat immédiat, pas un ajout progressif ; `/carts` interne reste réservé au staff), pages de détail par offre (tout est sur une page unique par organisation), notifications de confirmation par email au client (le contact est créé mais aucun e-mail de confirmation n'est envoyé — `EmailProvider` existe depuis la Phase 8 mais n'est pas encore branché sur les actions publiques), CMS/personnalisation visuelle de la boutique (couleurs, sections, images — page générique unique pour toutes les organisations).

## 20. Statut PHASE 12 (Hardening) — terminée

Dernière phase du MVP. Livrée et validée (typecheck + lint + build + tests unitaires/e2e sur tout le monorepo — 109/109 tests e2e stables sur la grande majorité des exécutions complètes ; plus construction et démarrage réels des trois images Docker de production contre de vrais MongoDB/Redis) :

- **Sécurité** :
  - CORS resserré à une allowlist explicite (`CORS_ORIGINS`) — `origin: true` avec `credentials: true` reflétait n'importe quelle origine, un risque réel puisqu'il permettait à n'importe quel site de faire des requêtes authentifiées pour le compte d'un utilisateur connecté.
  - Rate limiting resserré sur `POST /auth/register`/`POST /auth/login` (30/min, contre 120/min globalement) — la surface la plus exposée au brute-force puisqu'elle ne requiert aucune authentification préalable. Limite dimensionnée pour rester sans impact sur la suite e2e (le fichier le plus lourd en `auth/register`, `subscriptions.e2e-spec.ts`, en fait 13 dans le pire cas).
  - `compression()` (gzip/brotli) ajouté globalement.
  - `docs/security.md` (nouveau) : modèle d'authentification, garanties d'isolation tenant, gestion des secrets, validation des entrées, audit, et — honnêtement — les lacunes connues du MVP (`api_keys` non implémenté malgré la mention dans `docs/api.md` depuis la Phase 1 : brancher un mécanisme d'auth par clé sur l'ensemble des guards existants sans casser l'audit trail est un chantier à part entière, jugé trop risqué pour la dernière phase — voir `docs/security.md` pour le détail du raisonnement).
- **Tests complets** : tests unitaires ajoutés pour la logique pure jusqu'ici couverte seulement en e2e (`computeTotals`, `evaluateConditions`, `interpolate` — 20 nouveaux tests, colocalisés en `.spec.ts` à côté du code testé, même patron que `organizations.service.spec.ts` de la Phase 1).
- **Performance** : compression HTTP (ci-dessus). Pas de changement de fond sur les index/requêtes — déjà construits au fil de chaque phase plutôt que reportés ici.
- **Documentation** : `docs/security.md` et `docs/deployment.md` (nouveaux), `README.md` mis à jour (prérequis Node réel — `>=22.6`, pas `>=20` comme déclaré jusqu'ici alors que l'exécution TS native des packages partagés l'exige depuis l'ADR-001 —, section Documentation/Déploiement), `.nvmrc` ajouté.
- **Déploiement** : `Dockerfile` de production pour `apps/api`/`apps/web`/`apps/storefront` (contexte de build = racine du monorepo), `.dockerignore`, `.github/workflows/ci.yml` (typecheck/lint/build/tests sur chaque push/PR, MongoDB+Redis en services). Les trois images ont été réellement construites et démarrées pendant cette phase (pas seulement compilées) — un piège réel a été trouvé et corrigé au passage : `output: "standalone"` de Next.js casse au runtime avec les symlinks pnpm sur `@swc/helpers` (`MODULE_NOT_FOUND`, reproduit puis contourné en copiant `node_modules` en entier et en lançant `next start` directement via son binaire).

Non fait volontairement en Phase 12 (lacunes assumées et documentées plutôt que masquées) : `api_keys` (voir `docs/security.md`), rétrofit du gate de module de la Phase 10 sur les routes internes existantes (reste limité à l'activation d'un module), email de confirmation sur les actions publiques de la Phase 11, 2FA/verrouillage de compte, scan de vulnérabilités automatisé, hébergement réel provisionné, image Docker pour `apps/worker` (squelette non utilisé depuis l'ADR-005), workflow CI non encore exécuté sur GitHub (relu attentivement, reproduit les commandes validées manuellement des dizaines de fois pendant ce projet, mais sa première exécution réelle doit être surveillée).

Avec cette phase, les 12 phases du MVP KORVA OS décrites dans ce document sont terminées.

## 21. Post-Phase-12 — Hardening / Reconciliation

Les sections 1-20 ci-dessus décrivent le plan et le statut du MVP tel qu'il existait à la fin de la Phase 12 (commit `3053218`). Depuis, la branche locale `main` a avancé bien au-delà de ce commit ; à `HEAD = 1fb4dbeb410ef067c4e9c1d9ac208760f4253983` (Lot V, réconciliation documentaire comprise), `origin/main` est à `487699650e8c38f333d664ced0631fd02d510473` — les Lots R/S/T/U (entre autres) ont depuis été poussés, seuls les deux commits du Lot V (`9874dc8`, `1fb4dbe`) restent locaux/non poussés à cette date. Cette section documente factuellement les travaux réalisés depuis la fin de la Phase 12, sans réécrire les sections historiques ci-dessus — voir aussi `docs/PRODUCTION_READINESS.md` §27-§28 pour l'audit de sécurité/readiness correspondant.

### 21.0 `apps/worker`

Le squelette `apps/worker` décrit en §1/§3 (Phase 1) et dans la Phase 12 (ligne « image Docker pour `apps/worker` (squelette non utilisé) ») a été **supprimé** par le commit `c33edd6` (« chore: remove apps/worker (superseded by in-process BullMQ workers) »). Il n'existe plus dans le dépôt. Les workers BullMQ (traitement asynchrone des événements et des jobs de réconciliation) tournent aujourd'hui **exclusivement dans `apps/api`**, exactement comme décrit par l'ADR-005 (`docs/architecture-decisions.md`) — cette décision d'architecture n'a pas changé, seul le squelette `apps/worker` jamais câblé a été retiré.

### 21.A Scheduler BullMQ — réconciliation Payment/Refund

Commit `fee9608` (« feat: automatic Payment/Refund reconciliation scheduler (BullMQ repeatable job) »), antérieur aux Lots Q/R/S/T.

- **Objectif :** résoudre automatiquement les Payments/Refunds restés bloqués en `processing` (ex. crash entre l'appel provider et l'écriture Mongo), sans intervention manuelle.
- **Périmètre :** une deuxième queue BullMQ, `payment-reconciliation`, distincte de la queue `events` du Workflow Engine (Phase 7). Job répétable (intervalle configurable, 5 minutes par défaut), tournant dans `apps/api` selon le même patron que `EventsProcessor`.
- **Résultat :** `apps/api/src/finance/payments/reconciliation-scheduler.service.ts` (nouveau), câblé dans `finance.module.ts`, testé par `test/payment-reconciliation-scheduler.e2e-spec.ts`.
- **Limite, résolue depuis par le Lot V (commit `9874dc84bcb26aedd3c41bcb941375b13c6bfe74` — « fix(finance): configure retry/backoff on payment-reconciliation queue ») :** à l'origine (commit `fee9608`), cette queue n'avait pas reçu le durcissement retry/backoff apporté à la queue `events` par le Lot Q ci-dessous (voir 21.B) et tournait avec les valeurs par défaut de BullMQ (`attempts: 1`). Le Lot V a comblé ce gap : `ReconciliationSchedulerService` passe désormais un `opts` explicite (`attempts: 3`, backoff exponentiel démarrant à 2s, `removeOnComplete: { age: 24 * 3600, count: 1000 }`, `removeOnFail: false`) au 3ᵉ argument de `upsertJobScheduler`.

### 21.B Lot Q — retries fiables + idempotence des actions (commit `7796559`)

- **Objectif :** empêcher qu'un job de la queue `events` échoué silencieusement (attempts:1 par défaut) fasse perdre un événement métier, et empêcher qu'une relance BullMQ ré-exécute deux fois l'effet d'une action de workflow.
- **Périmètre :** `core/events/event-bus.service.ts` (ajout de `JobsOptions` — `attempts: 5`, backoff exponentiel démarrant à 2s), `core/events/event-names.ts`, `workflow/events.processor.ts`, nouveau schéma `WorkflowActionClaim` (`workflow/schemas/workflow-action-claim.schema.ts` — claim atomique avant exécution d'une action, index unique sur `(organizationId, workflowId, actionIndex, eventKey)`), `workflow/workflow-actions.service.ts`, `workflow/workflow-engine.service.ts`, `workflow/workflows.repository.ts`, `packages/types/src/workflow.ts`.
- **Résultat :** la queue `events` uniquement — retries avec backoff exponentiel, et protection contre le double-effet d'une action lors d'une relance.
- **Limite explicite à l'origine, résolue depuis par le Lot V (voir 21.A) :** la queue `payment-reconciliation` (21.A) n'était **pas** concernée par ce durcissement lors du Lot Q et restait sur les valeurs par défaut de BullMQ. Le Lot V l'a durcie séparément, avec des valeurs délibérément différentes plutôt qu'une copie à l'identique du Lot Q : `attempts: 3` (contre `5` pour `events`) — car chaque sweep re-dérive son périmètre depuis l'état courant de Mongo plutôt que d'agir sur des données de job, un retry BullMQ n'est donc qu'un nouveau sweep complet, et le tick suivant (~5 min par défaut) constitue déjà un filet de sécurité naturel — mais le même type de backoff exponentiel (2000 ms) et des politiques de rétention tout aussi explicites (`removeOnComplete`/`removeOnFail`).

### 21.C Lot R — métriques de queue BullMQ (commit `5fedead`)

- **Objectif :** donner une visibilité minimale sur l'état des deux queues existantes (`events`, `payment-reconciliation`) sans construire un système de métriques générique.
- **Périmètre :** `GET /health/queues` (`health/health.controller.ts`), `health/queue-metrics.service.ts` (nouveau) — expose les compteurs BullMQ agrégés (`waiting`/`active`/`completed`/`failed`/`delayed`/`paused`) pour les deux queues, via une connexion Redis courte et dédiée.
- **Résultat :** observabilité **ciblée sur ces deux queues uniquement**. Ce n'est pas un endpoint `/metrics` Prometheus générique et ne doit pas être présenté comme tel.

### 21.D Lot S — alerting sur échec définitif de job (commit `d378963`)

- **Objectif :** signaler qu'un job a définitivement échoué (attempts épuisés) sans construire une pile d'observabilité complète (pas de Sentry, pas de PagerDuty).
- **Périmètre :** `health/queue-alerting.service.ts` (nouveau), `health/health.module.ts`. Écoute l'événement BullMQ `'failed'` sur les deux queues via `QueueEvents`, journalise une ligne fixe et non identifiante (`QUEUE_JOB_FAILED — queue "<nom>" has a definitively failed job`) avec un cooldown de 5 minutes par processus.
- **Résultat :** une ligne de log, rien de plus — pas d'intégration avec un système d'alerte externe, pas de tracking d'erreur générique. Le gap « Error tracking (Sentry) : NOT_IMPLEMENTED » cité dans `docs/PRODUCTION_READINESS.md` §19 reste exact.

### 21.E Lot T — password reset (commit `0d1f289bc5337c26dfb636ae8eefb5aa8ae803dd`)

Ferme le gap « Password reset flow » cité en Phase 12 (ligne 336 ci-dessus dans une liste d'éléments volontairement non faits — cette liste reste correcte comme photographie historique de la Phase 12 elle-même ; le gap est refermé par ce commit, postérieur).

- **Endpoints :** `POST /auth/forgot-password`, `POST /auth/reset-password` (`identity/auth/auth.controller.ts`), publics, sous le même throttling que `login`/`register` (voir `docs/security.md` pour le détail complet, identique).
- **Token :** `randomBytes(32)`, hashé en SHA-256 avant stockage (jamais en clair), TTL 30 minutes, usage unique (consommation atomique MongoDB), une nouvelle demande invalide tout token précédent non utilisé pour le même utilisateur.
- **Ordre critique :** le nouveau mot de passe est haché (Argon2) avant que le token soit consommé ; le mot de passe n'est modifié qu'après consommation réussie du token ; les sessions de l'utilisateur sont révoquées après un reset réussi.
- **Anti-énumération :** réponse strictement identique que le compte existe ou non.
- **Tests :** `identity/auth/password-reset.service.spec.ts`, `identity/users/users.service.spec.ts`, `test/password-reset.e2e-spec.ts` (5 scénarios), en plus des tests `auth.controller.spec.ts` étendus.
- **Gap frontend, non résolu par ce lot au moment de son commit :** à `HEAD = 0d1f289`, `apps/web` ne contenait aucune route `/reset-password` ni `/forgot-password` (confirmé par inspection directe de `apps/web/src/app` à ce HEAD : seuls `dashboard`, `login`, `onboarding`, `register` existaient). Le backend était complet et testé de bout en bout via l'API ; la page qui consommerait ce flux restait un travail frontend séparé, non un échec du backend. **Ce gap a depuis été résolu par le Lot U (commit `4876996`) — voir 21.H.**

### 21.F Dependabot / CodeQL

Séparément des Lots Q/R/S/T (commit `6c5897d`, antérieur), `.github/dependabot.yml` et `.github/workflows/codeql.yml` ont été ajoutés au dépôt. La ligne « scan de vulnérabilités automatisé » listée comme non fait en Phase 12 (ligne 336 ci-dessus) reste une photographie correcte de l'état à la fin de la Phase 12 elle-même — elle a été comblée après, par un commit distinct de la Phase 12 et distinct des Lots Q/R/S/T. Voir `docs/security.md` section Dépendances.

### 21.G Chiffres de tests actuels

À `HEAD = 0d1f289bc5337c26dfb636ae8eefb5aa8ae803dd` : 17 fichiers `*.e2e-spec.ts` (170 blocs `it`/`test`, 170/170 exécutés), 17 fichiers `*.spec.ts` unitaires (156/156 exécutés), `password-reset.e2e-spec.ts` isolé : 5/5, répété 3 fois consécutives, déterministe. Ces chiffres remplacent, pour l'état courant, toute mention antérieure de « 109/109 » ou « 92 tests e2e » citée dans les sections historiques ci-dessus, qui restent des photographies correctes de leur propre époque.

Depuis ce HEAD, seuls certains chiffres ont été re-mesurés et documentés explicitement : tests unitaires `@korva/api` — **157/157** (Lot V, +1 fichier `.spec.ts`) ; tests `apps/web` Vitest — **17/17** sur 3 fichiers, typecheck et lint propres (Lot U, voir 21.H — infrastructure de test inexistante avant ce commit). Les chiffres e2e API ci-dessus (170/170) n'ont pas été intégralement re-exécutés et re-documentés depuis `HEAD=0d1f289` — ne pas les présenter comme un état de production readiness global sans nouvelle vérification directe (voir `docs/PRODUCTION_READINESS.md` pour les réserves connues sur la suite e2e complète).

### 21.H Lot U — password reset (frontend) (commit `4876996`)

Ferme le gap frontend explicitement laissé ouvert par le Lot T (voir 21.E) — aucun changement backend, `PasswordResetService`/`auth.controller.ts` (Lot T) restent la seule logique métier.

- **Périmètre :** `apps/web/src/app/forgot-password/page.tsx` (nouveau, 95 lignes) et `apps/web/src/app/reset-password/page.tsx` (nouveau, 150 lignes), chacun avec son test dédié (`page.test.tsx`, 103 et 142 lignes) ; `apps/web/src/app/login/page.tsx` (lien vers `/forgot-password` ajouté) ; nouvelle infrastructure de test `vitest` pour `apps/web` (`vitest.config.mts`, `vitest.setup.ts`, `apps/web/src/test/render.tsx` — `apps/web` n'avait aucun test avant ce commit) ; `apps/web/package.json`/`pnpm-lock.yaml` mis à jour pour les nouvelles dépendances de test.
- **Résultat :** les deux routes existent et sont fonctionnelles, consommant les endpoints `POST /auth/forgot-password`/`POST /auth/reset-password` déjà livrés par le Lot T.
- **Validations :** `pnpm --filter @korva/web test` → **17/17 tests Vitest verts** (3 fichiers) ; `pnpm --filter @korva/web typecheck` → propre ; `pnpm --filter @korva/web lint` → propre (script sans `--fix`). Aucune régression sur la suite `@korva/api` (non concernée par ce commit, fichiers disjoints).
