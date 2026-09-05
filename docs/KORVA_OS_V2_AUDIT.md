# KORVA OS V2 — Current State Audit, Target Architecture & Migration Plan

**Date:** 2026-09-05
**Scope:** read-only audit produced in response to the "Business Operating System V2" master brief (four independent products — CRM / Inventory / Website / AI — on a common KORVA Platform, with per-product entitlements). No product code was modified while producing this document, per the brief's explicit rule.
**Method:** 6 parallel source-code audits (not doc-trusting — every claim below is grounded in a file path) covering Platform, CRM, Inventory, Website, AI/Business Graph/Decision Engine/Action Center, and Entitlements/Verticals. This supersedes nothing from `docs/BUSINESS_OS_AUDIT.md` (2026-08-29) — that audit's roadmap (Business Graph, Decision Engine, Action Center, AI autonomy, verticals, widget, storefront customization) is now **fully shipped** (see `MEMORY.md` → business-os-pivot history). This document evaluates that same, now-mature codebase against the *new* framing: four independently-sellable products.

---

## PART 1 — CURRENT STATE AUDIT

### 1.1 Architecture actuelle

Modular monolith, unchanged shape from the original spec: pnpm monorepo, `apps/{web,api,worker,storefront}`, `packages/{ui,config,types,validation,eslint-config}`. NestJS API, Next.js dashboard + Next.js storefront, MongoDB/Mongoose, Redis/BullMQ. Multi-tenant via `TenantContext`/`organizationId`, never client-trusted.

`apps/api/src/app.module.ts` wires **24 modules flat, with no product-boundary grouping**: `Events, Health, Audit, Identity, Subscriptions, Organizations, CustomFields, Crm, Catalog, Finance, Booking, Commerce, Communication, Workflow, Ai, Analytics, Public, CustomerAuth, Reviews, Integrations, BusinessGraph, DecisionEngine, ActionCenter, WebhookSubscriptions`. Global guard chain: `ThrottlerGuard → JwtAuthGuard → TenantGuard → ModuleGuard → PermissionsGuard`.

**Central finding, load-bearing for everything below:** there is no concept of "product" anywhere in the codebase today. Entitlement/feature gating is a flat 9-key enum, `KorvaModule = "crm" | "catalog" | "booking" | "commerce" | "finance" | "workflow" | "communication" | "analytics" | "ai"` (`packages/types/src/organization.ts:17-27`), stored as `Organization.enabledModules: KorvaModule[]`. "Inventory" and "Website" are not module names, not product names, not anything — Inventory's capabilities are split across `catalog`+`commerce`; Website (the storefront) isn't a module at all, it's unconditional infrastructure every org gets automatically.

### 1.2 Produits actuels (vs. the V2 four-product model)

| V2 Product | Current reality |
|---|---|
| **KORVA CRM** | Real module (`crm`), but internally incomplete against the CRM spec — see 1.4. |
| **KORVA INVENTORY** | **Does not exist as a named product.** Capabilities live under `catalog` (offers/stock/PO) + slice of `commerce` (orders/fulfillment/returns). No warehouses. No inventory analytics. No inventory AI. |
| **KORVA WEBSITE** | **Does not exist as a togglable product at all.** `apps/storefront` renders for every org unconditionally; not in `KORVA_MODULES`; cannot be disabled or sold standalone; **zero test infrastructure** (`apps/storefront/package.json` has no test script, no jest/vitest/playwright config anywhere in the app). |
| **KORVA AI** | Real module (`ai`), 23 tools, but no per-product coverage parity (see 1.5) and no graduated autonomy model. |
| **KORVA PLATFORM** | Solid and mostly spec-compliant — see 1.3. |

### 1.3 KORVA Platform — audit

- **Identity** (`apps/api/src/identity/`): JWT + rotating/reuse-detected refresh sessions, TOTP 2FA (`auth/two-factor.service.ts`), email verification, password reset, API keys (scoped, server-to-server), invitations. RBAC: 6 system roles, ~70 flat `"resource.action"` permissions (`packages/types/src/rbac.ts`), custom org roles supported, but only a flat rank list — no real role-hierarchy engine. **Matches spec closely.**
- **Organizations**: single `Organization` + `Membership` (flat org→user, no Team entity — spec mentions "teams" but none exists; not flagged as urgent, no feature currently needs it).
- **Billing/Subscriptions** (`apps/api/src/subscriptions/`): `Plan` (modules + limits), `Subscription` (one plan per org, `status: active|past_due|canceled` — `past_due` is unreachable, no PSP dunning wired), `Usage`. **This is the module requiring the most V2 rework** — see 1.6.
- **Infrastructure**: Audit logs (`audit/`, functional, no retention policy), Integrations (`integrations/`, AES-256-GCM encrypted credentials, platform+tenant scope), Webhooks outbound (`webhook-subscriptions/`, HMAC-signed, BullMQ retries), Notifications (`communication/notifications/` — exists, but organizationally lives inside Communication, not a platform-level concern), Files (`shared/storage/`, pluggable local/S3), background jobs (BullMQ, ~10 scheduler services). **Matches spec, with the Notifications module placement being the only structural quibble** (cosmetic, not a functional gap).
- **Intelligence infra**: Events (28 `SYSTEM_EVENTS`, one-way into Decision Engine/Workflow/Action Center), Business Graph, Decision Engine, Action Center — see 1.5, all real but shallower than the V2 vision.

### 1.4 KORVA CRM — audit

| Sub-area | Status | Detail |
|---|---|---|
| Contacts | Partial | Full CRUD, merge/dedup (`POST /contacts/:id/merge`, `GET /contacts/duplicates`), tags, custom fields, consent tracking. **Missing**: no Company/Account entity (company is a plain string field), no contact-relation graph, no CSV import/export, segmentation limited to tag/field filters (no saved Segment entity). |
| Leads | Partial | Source (free string), pipeline/stage, owner, value, probability. **Missing**: no scoring, no attribution model, no auto-routing (owner is always manually set), no distinct "conversion" step. |
| **Deals** | **Does not exist as a separate entity.** `Lead` is overloaded to carry `pipelineId`/`stageId`/`estimatedValue`/`probability` — a real multi-stage `Pipeline` model exists (`crm/pipelines/`) but only attaches to Leads. Finance's `Quote` has a status enum but no stage/probability/pipeline linkage. This is the single biggest CRM data-model gap. |
| Activities | Partial | Tasks/notes/activities exist, scoped only to contact/lead; no attachments, no auto-logging of sent emails/WhatsApp into the activity timeline. |
| Communication | Partial | Real unified inbox (`Conversation`/`Message`), real Email (Resend) + WhatsApp (360dialog) providers; SMS has no real provider (log-only fallback). No campaign/broadcast sends, single-conversation only. |
| **Marketing** | **Does not exist.** No Campaign, Segment, LandingPage, or form-builder entity anywhere. |
| **Customer Service** | **Does not exist.** No ticket/SLA/priority/KB entity. (`commerce/kitchen`'s `KitchenTicket` is an unrelated restaurant kitchen-prep ticket; `reviews/` is CSAT-adjacent but not ticketing.) |
| Automation | Partial | Real trigger→condition→action engine (`workflow/`), but only 4 action types (create_task/send_email/webhook/internal_notification — no SMS/WhatsApp action, no "change stage"/"assign owner" action), 4 condition operators AND-only, event triggers only (no scheduled/cron triggers), sparse CRM event coverage (`lead.created` is the only CRM trigger event actually published). |
| Analytics | Partial | Lead-count and revenue-timeseries only; no pipeline/funnel conversion, no forecasting, no per-rep performance. |
| Customization | Partial | Real generic custom-field engine, but limited to 5 entities (contacts/leads/offers/bookings/orders — no tasks/tickets/deals); no custom objects, no saved views. |

### 1.5 KORVA Inventory — audit

| Sub-area | Status | Detail |
|---|---|---|
| Product Catalog | Partial | `Offer`+`OfferVariant`+`Category` exist with pricing/SKU. **Missing**: no attributes system, no barcode field anywhere in the repo, no bundle/kit concept, no unit-of-measure. |
| Inventory | Partial, single-location only | `Offer.stockOnHand`/`OfferVariant.stockOnHand` — one number per offer/variant, atomically guarded (`InventoryService.reserveStock`/`restockItems`), append-only `StockMovement` ledger, low-stock events wired to Decision Engine. No reserved-vs-available split, no valuation/COGS. |
| **Warehouses** | **Does not exist at all.** No `Warehouse`/`Location`/`Bin`/`Transfer` entity anywhere in the repo. This is the single largest Inventory gap — stock cannot be represented at more than one physical location. |
| Purchasing | **Exists and works** (added 2026-09-03/04, commits `2c797be`/`831a34a`) | `Supplier` (minimal: contact info only, no pricing history), `PurchaseOrder` with genuine partial receiving (`PurchaseOrdersService.receive`), each receipt increments the single global stock counter. |
| Sales fulfillment | Partial | Orders reserve stock at creation; real returns/refunds flow (`commerce/returns/`) restocks correctly. Still against the single global counter — no per-location pick/ship. |
| **Analytics** | **Does not exist.** No turnover/dead-stock/valuation/best-seller reporting anywhere, despite `StockMovement` already logging the data that would feed it. |
| **AI** | **Does not exist.** Only `search_offers`/`get_offer` tools; no forecasting, reorder-suggestion, dead-stock-detection, or supplier-analysis tool. |

### 1.6 KORVA Website — audit

Architecture: one Next.js app rendering a fixed template per org (6 selectable templates — `vitrine, table, boutique, academie, salon, essentiel`, `packages/types/src/storefront-themes.ts`), content-slot configuration (branding, sections, testimonials/team/gallery/FAQ — the last four Pro-gated), **not** an arbitrary page/layout builder.

| Sub-area | Status |
|---|---|
| Site creation/template choice | Partial — 6 real templates, but each is a hardcoded React component; no layout editing within a template. |
| Page/section/component editing | Partial — content values only (text/images/toggles), no structural editing. |
| Menus | **Does not exist.** |
| Branding | Partial — logo/color/tagline/hero/palette/font-pairing; no custom CSS, no typography beyond presets. |
| Domains | **Does not exist.** No custom-domain field anywhere; storefront is only reachable at `{STOREFRONT_URL}/{slug}`. |
| SEO | Partial — auto-derived meta tags exist, but no org-configurable override; `sitemap.ts` cannot enumerate tenant slugs (no public "list organizations" endpoint), so per-tenant pages aren't actually in the sitemap. |
| Forms | Partial — lead-capture widget only (leads/catalog/booking/full modes for embedding on an external site); no general form builder for the storefront page itself. |
| Analytics | **Does not exist.** |
| E-commerce/catalog/booking/payment | Exists, gated by module+section toggles, working. |
| Blog/landing pages | **Does not exist.** |
| **Auto-generation at signup** | **Does not exist as spec'd.** Onboarding only scrapes an *existing external site's* `<title>`/OG tags — it does not generate a site from the org's own entered sector/products/services/contact data. |
| **Standalone activation** | **Does not exist.** Storefront is not a `KorvaModule`; every org gets one automatically; it cannot be disabled or sold as an independent product today. |
| Test infrastructure | **Confirmed absent** — zero test files, zero test config, no test script. |

### 1.7 KORVA AI, Business Graph, Decision Engine, Action Center — audit

- **AI tools** (23, `apps/api/src/ai/tools/`): CRM (search/create contacts, leads, tasks, quotes, send email/WhatsApp), Booking/Commerce (offers, availability, bookings, orders, sales report), and a generic recommendation read/act set. **Zero Website tools** (no module exists). **Zero Inventory-specific tools** (no forecasting/reorder/dead-stock/supplier-analysis — `get_sales_report` is revenue-only, not predictive). **No global cross-product reasoning tool** — nothing answers "what needs my attention today" / "why is revenue down" by reasoning across products; closest is `list_recommendations`, which just reads Decision Engine output.
- **Business Graph** (`apps/api/src/business-graph/`): exactly **one** endpoint, a per-contact timeline assembled live from Contact/Lead/Task/Quote/Invoice/Payment/Booking/Order/Conversation. Explicitly documented in its own source as "a projection, not a new source of truth." No supplier/inventory/website nodes, no cross-contact or aggregate graph queries — this is a read-model, not the relational substrate the V2 vision describes.
- **Event System**: 28 event types (`packages/types/src/workflow.ts`), published across CRM/Finance/Booking/Commerce/Catalog/Communication/Subscriptions. Website publishes nothing (no module exists).
- **Decision Engine**: exactly **4** deterministic rules (invoice overdue, customer inactive, stock depleted, stock low). No dead-stock, reorder, supplier, SEO, or lead-scoring rule exists yet.
- **Action Center**: 4 flat feed types (pending_approval, recommendation, workflow_failure, webhook_delivery_failure), no severity tiering (urgent/attention/opportunity/recommendation), no `impact`/`confidence`/`history` fields — the V2 spec's Action Center framing (§13) is not yet implemented, only a flatter precursor of it.
- **AI Autonomy**: **no graduated 0-4 model exists.** The only real gate is a binary `sensitive?: boolean` flag on each tool (`cancel_booking, send_email, send_whatsapp, create_order` are sensitive, requiring one human confirmation via `AiPendingAction`; everything else runs inline). This is a confirmed, real gap against V2 §14.

### 1.8 Entitlements — audit (the structural blocker for the whole V2 vision)

- Exact shape: `KORVA_MODULES` (9 flat keys) → `Organization.enabledModules` + `Plan.modules`. **No product-bundle concept exists at any layer.**
- 4 plans (`free/starter/pro/business`); only `starter` differs from the rest (excludes `workflow`+`ai`) — there is no plan today that could express "CRM + AI only" or "Inventory only."
- Enforcement is **per-controller**, not per-endpoint: `@RequireModule()` + `ModuleGuard` checks the whole `crm`/`catalog`/etc. controller tree against `enabledModules`; `EntitlementsService` separately checks the *plan's* modules only when a module is being toggled on — two copies that must be kept in sync manually.
- One `Subscription` → one `Plan` per org (unique ref) — no mechanism for independent per-product purchase today.

### 1.9 Sectors/Verticals — audit (this part of the spec is already fully honored)

`VERTICAL_TEMPLATES` (16 templates, `packages/types/src/verticals.ts`) are pure onboarding config — pre-fill `Organization.type` (free string), pre-check module checkboxes, seed one starter Workflow, pick a default storefront template. **Zero sector-conditional code branches found anywhere** (`grep` for `.sector ===`/`.secteur ===`/`vertical ===` across the whole API and web app returns nothing). Every "vertical feature" shipped in the Business OS pivot (staff-linked booking, credit balances, order modifiers/tipping, table links, generic PDF certificates) is implemented as a generic, reusable primitive with explicit doc comments stating this design intent (e.g. `inventory.service.ts:15-16`, `credit-balance.schema.ts:9`, `resource.schema.ts:79-81`). **No work needed here** — this is a genuine strength to preserve, not a gap to close.

### 1.10 Tests

API: ~750 unit tests / ~480 e2e tests, deep coverage, one long-documented sandbox-contention flake pattern (different random file per run, always clean standalone — see `feedback_korva_os_stale_test_processes` memory). `apps/web`: solid unit coverage. **`apps/storefront`: zero test infrastructure** — a real risk if Website becomes an independently sold, entitlement-gated product, since regressions there would currently be caught only by typecheck/lint/manual smoke testing.

### 1.11 Technical debt / structural problems, ranked

1. **No product abstraction** — the single blocker preventing "sell CRM/Inventory/Website/AI independently." Everything else in this list is a sub-product gap, this one is architectural.
2. **Website isn't a real, independently-activatable product** — no module key, always-on, zero tests. Currently the furthest from the V2 vision of any of the four products.
3. **Inventory has no name/identity, no warehouses, no analytics, no AI** — second furthest from the V2 vision.
4. **Deal/Opportunity has no independent entity** — overloaded onto Lead; the highest-risk data-model change in the whole plan if fixed.
5. **AI autonomy is binary, not graduated** — a real, cleanly-fixable gap (see target architecture).
6. **Action Center has no severity/impact/confidence framing** — additive fix, low risk.
7. **Marketing and Customer Service are fully absent CRM sub-domains.**
8. **Business Graph is a single-entity read-model**, not a real relational graph — blocks the "global AI questions" vision.

No dead code, no forked/duplicated logic across verticals was found — reuse discipline has been consistently strong throughout the project's history.

---

## PART 2 — TARGET ARCHITECTURE

The guiding constraint from the brief: **do not rewrite what works.** Every change below is additive or a narrow, backward-compatible extension of an existing entity — nothing in §1 needs to be deleted or forked.

### 2.1 Platform: introduce a real Product layer

- New type `KorvaProduct = "crm" | "inventory" | "website" | "ai"` (`packages/types`).
- New mapping `PRODUCT_MODULES: Record<KorvaProduct, KorvaModule[]>` — e.g. `crm → [crm, communication, workflow, analytics]`, `inventory → [catalog, commerce]`, `website → [website (new)]`, `ai → [ai]`. `finance` and `booking` are genuinely cross-cutting (used by CRM billing *and* Inventory fulfillment *and* Website checkout) — model them as **platform-shared capabilities**, not owned by one product, exposed to whichever product needs them rather than forcing an artificial single owner.
- Promote `website` to a real `KorvaModule` (today it's unconditional infra) — default **on** for every existing org (zero regression), gated going forward via the same `ModuleGuard`/`@RequireModule('website')` pattern already used everywhere else.
- Extend `Subscription` with an optional `productOverrides?: Partial<Record<KorvaProduct, boolean>>`, layered on top of the plan's default module bundle. `EntitlementsService` resolves `effectiveModules = plan.modules ∩ expand(productOverrides)`. This avoids a combinatorial explosion of new `Plan` rows for every product combination while making "CRM + AI only" genuinely expressible.
- Settings/Billing UI gains a product-toggle row (CRM/Inventory/Website/AI) alongside — not replacing — the existing fine-grained module toggles, mirroring the "plan tier + module list" pattern already established.

### 2.2 Action Center + Decision Engine: severity framing (cheap, unlocks the V2 UX language)

- Add optional `severity: "urgent" | "attention" | "opportunity" | "recommendation"`, `impact?: string`, `confidence?: number` to `Recommendation` and `ActionCenterItem` — purely additive fields, existing 4 rules get one new field each, frontend groups the feed by severity instead of one flat list.

### 2.3 AI Autonomy: layer a graduated model over the existing binary gate

- Introduce `autonomyLevel: 0 | 1 | 2 | 3 | 4` as a *derived, not replacing* concept: levels 0-2 (answer/recommend/prepare) map to today's non-sensitive tools; level 3 (execute-with-confirmation) maps exactly to today's `sensitive: true` tools + `AiPendingAction`; level 4 (autonomous-for-explicitly-authorized-actions) is new — an opt-in, per-org, per-tool "auto-approve" setting that, when enabled, skips the confirmation step for that specific tool. This is additive: nothing about today's `sensitive` mechanism needs to change, level 4 just adds a bypass in front of it.

### 2.4 Inventory: fill the product out, in order of leverage

- Additive catalog richness: `attributes`, `barcode`, `bundle`/`kit` fields on `Offer`/`Category` (zero-risk optional fields).
- **Warehouses** (the significant piece): new `Warehouse`/`Location` entities + `StockLevel{offerId, warehouseId, quantity}` collection. Migration strategy: keep `Offer.stockOnHand` as a **maintained aggregate** (sum of `StockLevel` rows) for orgs that never opt into multi-warehouse — every existing single-location org sees byte-identical behavior; multi-warehouse becomes available only once an org creates a second `Warehouse`.
- Inventory analytics (turnover/dead-stock/valuation) reading the already-existing `StockMovement` ledger — no new instrumentation needed, just new aggregation queries.
- Inventory AI tools (reorder suggestion, dead-stock detection, supplier lead-time analysis) — new Decision Engine rules feed new AI tools, same pattern as the existing low-stock rule.

### 2.5 CRM: fill the product out, highest-risk item first

- **Deal/Opportunity as an independent entity** — the single riskiest migration in this plan. `Lead` stops carrying `pipelineId`/`stageId`/`estimatedValue`/`probability` directly; a `Deal` is created on lead conversion, referencing `Pipeline`/`Stage` and the originating `Lead`. Needs its own dedicated plan-mode design pass (data migration script for every existing Lead-with-pipeline-data) before any code is touched — **do not fold this into a generic sprint, treat it as its own sign-off point.**
- Marketing: new `Segment` entity (reuses existing contact/lead filter logic), campaign send (reuses existing Communication/template rails) — additive new module, no changes to existing CRM entities required.
- Customer Service: new `Ticket` entity (reuses the existing `Conversation` model + adds priority/SLA/assignment fields) — additive new module.
- Lead scoring + auto-routing rules, Decision-Engine-driven, same rule pattern as existing rules.

### 2.6 Website: the biggest lift, sequenced last

- Make storefront rendering conditional on `enabledModules.includes('website')` (depends on 2.1) — verify an org with only Website active still renders a fully working public site with everything else off.
- Real auto-generation at signup: populate content sections from the org's *own entered* sector/products/services/contact data (today it only scrapes an external URL) — reuses the same content-slot fields already built for manual editing.
- Custom domain support (v1: `Organization.customDomain` field + CNAME instructions + Next.js host-based middleware routing).
- SEO overrides (org-configurable meta title/description) + fix `sitemap.ts` to actually enumerate tenant slugs via a new scoped public endpoint.
- **Build test infrastructure for `apps/storefront` before or alongside this work** — a prerequisite for treating Website as a real, independently monetized product with a quality bar, not an optional nice-to-have.

### 2.7 Business Graph: expand from read-model toward real substrate

- Extend the assembly beyond per-contact timeline to include Supplier/PurchaseOrder nodes and an **org-level aggregate query surface** (not just single-contact anchored).
- This — combined with 2.2's severity data — is what finally lets a new global AI tool answer cross-product questions ("what needs my attention today," "why is revenue down") instead of only reading a flat recommendation list.

---

## PART 3 — MIGRATION PLAN

Sequencing follows the brief's own stated priority order (correctness → security → tenant isolation → backward compatibility → architecture → UX → optimization) and this project's established discipline: small additive increments, full typecheck/lint/test/build cycle + commit + auto-push per increment, real product-direction forks put to the user via a question rather than assumed.

**Phase A — Platform product layer (foundation; everything else depends on this)**
- A1. Add `KorvaProduct` + `PRODUCT_MODULES` mapping (pure types, zero runtime change).
- A2. Promote `website` to a real `KorvaModule`, default-on everywhere, gate storefront rendering + public API routes behind it.
- A3. Add `Subscription.productOverrides` + `EntitlementsService` resolution logic; expose product toggles in Settings/Billing UI alongside existing module toggles.

**Phase B — Action Center + AI autonomy framing (cheap, unlocks V2's UX/AI language)**
- B1. Add `severity`/`impact`/`confidence` fields to Recommendation/ActionCenterItem; update the 4 existing rules; regroup the frontend feed by severity.
- B2. Add the graduated `autonomyLevel` concept + per-org/per-tool auto-approve setting (level 4), layered over the existing `sensitive` gate.

**Phase C — Inventory product completion**
- C1. Catalog richness (attributes/barcode/bundle — additive fields).
- C2. Warehouses/Locations + per-location `StockLevel` (the significant migration; `Offer.stockOnHand` becomes a maintained aggregate for backward compatibility).
- C3. Inventory analytics (turnover/dead-stock/valuation) off the existing `StockMovement` ledger.
- C4. Inventory AI tools (reorder suggestion, dead-stock detection, supplier analysis).

**Phase D — CRM product completion**
- D1. **Deal/Opportunity decoupled from Lead** — flagged as its own dedicated design+migration sign-off point, not a routine increment, given it's the highest-risk data-model change identified in this audit.
- D2. Marketing (Segment + campaign send, reusing Communication rails).
- D3. Customer Service (Ticket entity, reusing Conversation model).
- D4. Lead scoring + auto-routing (Decision-Engine-driven).

**Phase E — Website product completion (sequenced last — most greenfield, needs test infra built from scratch)**
- E1. Verify Website-only activation works end-to-end (depends on A2).
- E2. Real auto-generation at signup from entered business data.
- E3. Custom domain support (v1: CNAME + host-based routing).
- E4. SEO overrides + sitemap fix (real tenant enumeration).
- E5. Test infrastructure for `apps/storefront` (currently zero) — build this before/alongside E2-E4, not after.

**Phase F — Business Graph + global AI (ties everything together)**
- F1. Expand Business Graph beyond per-contact timeline (supplier/PO nodes, org-level aggregate queries).
- F2. New global AI tool(s) answering cross-product questions, built on F1 + Phase B's severity data.

**Rationale for the ordering:** A and B are cheap, additive, and unlock every other phase's proper "product" framing — they should go first regardless of which product the user wants to prioritize next. C (Inventory) and D (CRM) are independent of each other and can be reordered or interleaved based on business priority. E (Website) is deliberately last — it's the most novel work and the one product area with zero existing test safety net, so it needs that net built before or during the work, not after. F depends on both C/D's richer data model and B's severity framing to be meaningful, so it comes last.

**Explicit risk flag:** D1 (Deal/Opportunity) is the one item in this entire plan that touches existing production data (every Lead currently carrying pipeline/stage/value data) rather than purely adding new optional fields/entities. Per this project's own established practice, it should get its own `EnterPlanMode` design pass with a real user sign-off before any code is written, independent of the rest of this migration plan's sequencing.

---

**No code has been modified to produce this document**, per the brief's mandatory phase order. Next step per that same brief: agree on which phase to start with (Phase A is the recommended default, since B–F all build on it) before any implementation begins.
