# KORVA OS — Implementation Plan

Statut : PHASE 1 (Foundation), PHASE 2 (CRM), PHASE 3 (Catalog) et PHASE 4 (Finance) terminées et validées — voir sections 9-13. PHASE 5 (Booking) non démarrée.
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

## 13. Prochaine étape

Démarrer PHASE 5 (Booking) : resources, availability, bookings — en réutilisant Contacts (client de la réservation), Offers (type `booking`), et potentiellement Quotes/Invoices pour la facturation d'une réservation.
