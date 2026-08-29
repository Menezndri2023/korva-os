# KORVA OS — Business Operating System Transformation Audit

**Date:** 2026-08-29
**Scope:** read-only product/architecture audit preceding the Business OS transformation brief. Cross-checked against `docs/IMPLEMENTATION_PLAN.md`, `docs/PRODUCTION_READINESS.md` (§1–28), `docs/architecture/integrations-platform.md`, and direct source inspection (`apps/api/src`, `apps/web/src`). Claims from those docs were spot-checked against current `HEAD`, not taken at face value — two were found stale (2FA and API keys are now implemented; see §1).
**Method:** no new product code was written as part of this audit. Separately, while validating the repository's baseline state (required before auditing "what exists"), one pre-existing e2e test-infra bug was found and fixed — see the note at the end of §1.

---

## 1. Carte des capacités actuelles de KORVA

KORVA OS is **far more built-out than a blank-slate MVP**. 12 founding phases plus four post-MVP hardening waves are complete and committed:

| Domain | What's real (not mocked) |
|---|---|
| **Identity/Tenancy** | JWT + rotating refresh sessions, 6 system roles + RBAC guard chain, multi-tenant isolation (spoof-resistant `TenantContext`), password reset, email verification, **2FA (TOTP)**, **API keys** (server-to-server auth with scopes) — both more recent than `docs/PRODUCTION_READINESS.md`'s "NOT_IMPLEMENTED" verdict, confirmed live in `identity/auth/two-factor.*` and the API-keys module at `HEAD`. |
| **CRM** | Contacts, leads, pipelines, tags, activities/tasks/notes, custom fields engine (reused across modules). |
| **Catalog** | Unified `Offer` entity (6 types), categories, variants, pricing, custom fields. |
| **Finance** | Quotes→Invoices lifecycle, Payments/Refunds with **MongoDB transactions + Idempotency-Key protection** (just hardened further in the uncommitted diff validated this session — mandatory Idempotency-Key on refunds, Stage 2.7B), **Expenses module** (full CRUD + RBAC + lifecycle), automatic **quote-expiry** and **invoice-overdue** BullMQ schedulers that publish real events. |
| **Booking** | Resources, weekly availability + blocked slots, capacity-aware `AvailabilityService`, reschedule/cancel. |
| **Commerce** | Unified `Order` engine (cart/booking/manual sources), fulfillments (architecture-ready). |
| **Workflow/Events** | Real `EventBusService` (BullMQ, retries+backoff, idempotent action claims), `WorkflowEngineService` (trigger/condition/action), 4 action types (`create_task`, `send_email`, `webhook` with **SSRF hardening**, `internal_notification`). |
| **Communication** | Real `EmailProvider` (Resend), real **WhatsApp via 360dialog** (adapter + webhook + consent/opt-in gate — this closes the "MOCKED messaging" gap `PRODUCTION_READINESS.md` flagged), conversations/messages, templates. |
| **Integrations platform (Wave 4)** | Generic encrypted credential store (`IntegrationAccount`, AES-256-GCM), generic inbound webhook pipeline with idempotency, **real Flutterwave v3** payment adapter + settlement/reconciliation scheduler, tenant-facing Integrations UI in Settings. |
| **AI** | Real Anthropic tool-calling orchestrator, **19 tools**, **4 agent personas** (`sales_agent`, `booking_agent`, `analytics_agent`, `general_assistant`), human-confirmation gate (currently only `cancel_booking` + the new `send_whatsapp` consent confirmation), tenant-scoped throughout. |
| **SaaS** | 4-tier plan catalog, `EntitlementsService` (modules/seats/AI usage), subscription lifecycle states. |
| **Storefront** | Public per-org page (path-based), public catalog/booking/checkout, server-recomputed pricing. |
| **Hardening** | CORS allowlist, rate limiting, Docker multi-stage builds, CI (typecheck/lint/build/unit/e2e), Dependabot/CodeQL, audit logging. |

**Test baseline (verified this session, not assumed from docs):** `pnpm -r typecheck`/`lint` clean; **618/618** API unit tests, **350/350** web unit tests, **≈845 e2e assertions across 26 files** all pass after one fix (below). This is a materially higher bar than the stale "109/109" figure still floating in historical doc sections.

**Bug found and fixed during this audit (test infra, not product code):** `finance.e2e-spec.ts` had grown — across several independently-landed hardening lots (Idempotency-Key, Expenses module, two schedulers) — past `AUTH_THROTTLE`'s documented 30-registrations/60s-per-file budget (35 actual registrations), a convention this codebase already follows deliberately elsewhere (`catalog.e2e-spec.ts`, `payment-reconciliation.e2e-spec.ts` both carry comments about staying under this budget). It failed deterministically, not flakily. Fixed by extracting the three self-contained describe blocks — each already boots its own app — into `expenses.e2e-spec.ts`, `quote-expiry-scheduler.e2e-spec.ts`, `invoice-overdue-scheduler.e2e-spec.ts`. No test semantics changed; `finance.e2e-spec.ts` is back to 28 registrations. Full suite now green.

---

## 2. Carte des opérations métier (framework de la mission)

| Opération | Statut | Preuve / limite |
|---|---|---|
| Lead → Client | **COMPLÈTE** | CRM pipeline, `lead.created`/`customer.created` events wired to Workflow. |
| Client → Vente (devis/facture) | **COMPLÈTE** | Quote→Invoice→Payment, server-recomputed totals, transactional. |
| Client → Réservation | **COMPLÈTE** | Booking engine with real availability/capacity. |
| Réservation → Paiement | **PARTIELLE** | `Booking.paymentStatus` exists but isn't driven by a real Payment record end-to-end outside the Order Engine path; no deposit/acompte flow. |
| Paiement → Facture | **COMPLÈTE** | Atomic, idempotent, transactional. |
| Commande → Exécution | **PARTIELLE** | `Fulfillment` is architecture-ready, no real carrier integration. |
| Client → Communication | **COMPLÈTE** | Real email + WhatsApp send, consent-gated. |
| Client → Fidélisation | **MANQUANTE** | No "customer value," "days since last activity," or re-engagement concept anywhere — no `customer.inactive` event, no churn/reactivation logic. This is the single most-cited example pattern in the vision brief (§1, §8, §18, §19) and it does not exist today in any form. |
| Événement → Automatisation | **COMPLÈTE for what's wired** | EventBus→Workflow is real and reliable (retries, idempotent claims). Only 6 business services currently publish events; most domains (Expenses, Catalog, Communication sends) don't emit anything workflows could react to. |
| Données → Insight | **PARTIELLE (shallow)** | `analytics` module exists (`GET /analytics/overview`, `/activity`) — real KPI aggregation, not mocked. But it stops at the number: no "what this means," no trend-over-trend narrative, no anomaly surfacing. |
| Insight → Recommandation | **MANQUANTE** | Nothing in the codebase proposes a next action from data. `get_sales_report` is a read-only AI tool, not a standing recommendation engine. |
| Recommandation → Action (avec approbation) | **MANQUANTE structurellement, EXISTE comme primitive isolée** | The `AiPendingAction` confirm/reject mechanism is exactly the right *primitive* for "prepare → approve → execute," but it's wired to exactly one AI tool call at a time, not to any system-generated recommendation. There's no entity representing "a recommendation KORVA made on its own." |
| Action → Résultat → nouvelle donnée | **COMPLÈTE at the mechanical level** | Every action in this system (workflow or AI tool) writes real data back, which re-enters the graph. The loop is mechanically closed; it's just never been *triggered by KORVA's own reasoning*, only by a human or a pre-configured trigger. |

**Reading this table honestly:** KORVA has built a very solid, very real **operational core** (the bottom half of the vision's loop: DONNÉES → ÉVÉNEMENTS → ACTION → AUTOMATISATION → RÉSULTAT). What's entirely missing is the **top half** (CONTEXTE → COMPRÉHENSION → DÉCISION → RECOMMANDATION) — the part that would make it feel like an OS that understands the business, rather than a very well-built CRM/ERP.

---

## 3. Fonctionnalités manquantes (vision-critical, not just "nice to have")

1. **Business Graph as a first-class concept.** The relational data for it already exists (Contact↔Lead↔Quote↔Invoice↔Payment↔Booking↔Order are already cross-referenced by ObjectId in the schemas) — but there is no unified read model, no "customer 360" timeline endpoint, nothing the AI or a human can query as "show me everything connected to this customer." This is graph-by-implication, not graph-by-design.
2. **Decision Engine.** The brief is explicit: rules engine + data + events + analytics, *not* an LLM standing in for deterministic business rules. Nothing like this exists. The only "if X then Y" logic is the Workflow Engine, which is human-authored per-organization, not a system-maintained set of business-health rules ("invoice unpaid > 7 days → flag risk").
3. **Action Center.** Does not exist in any form — no aggregation of pending approvals, recommendations, automation run history, and failures into one place. This is explicitly called out in the brief as a "central KORVA experience" (§17) and currently there is zero UI or backend surface for it.
4. **Recommendation entity + lifecycle.** No `Recommendation`/`Insight` schema anywhere. Nothing persists "KORVA noticed X and suggests Y" as a first-class, auditable object with its own approve/reject/execute lifecycle (distinct from `AiPendingAction`, which is tied to a live chat tool call, not a background-generated insight).
5. **Customer lifecycle/fidélisation signals.** No inactivity detection, no "hasn't returned in N days," no customer-value scoring.
6. **AI autonomy levels 4–6.** Today's AI can execute (level 5, gated) but cannot *prepare* something proactively (level 4 — "I prepared a reactivation campaign for 37 customers") or run on a fully-autonomous authorized rule (level 6 — "automatically send booking reminders"). There's no scheduled/background AI reasoning at all; it only runs inside a live chat turn.
7. **External website connectivity (§9–11 of the brief).** There is no embeddable widget/SDK for a business's *existing* site to talk to KORVA (lead capture, booking widget, checkout button). The storefront only works as KORVA's own hosted page per org.
8. **Self-serve website builder / "import my business from a URL."** `apps/storefront` is one fixed generic template per organization, not a customizable site, and there is no onboarding flow that scrapes/imports an existing public site's info for the user to review and confirm.
9. **Vertical-aware onboarding.** Onboarding collects org profile + module selection, but nothing adapts the flow or default workflows/catalog types to "this is a salon" vs. "this is a restaurant" as described in §13–14 of the brief. The data model is already intentionally generic enough to support this (no schema change needed) — it's a pure onboarding/configuration-templates gap.
10. **Dashboard philosophy shift.** Current dashboard = KPI cards + activity feed (textbook "collection de KPI" the brief explicitly says to move away from in §20). No "what needs my attention," no "what I recommend," no "what KORVA can do for you" sections.

---

## 4. Gaps architecturaux

- **No read-model layer for cross-entity context.** Every module is clean and isolated (good for the operational core), but that means there's no existing seam to hang a Business Graph query off of — it would need a new, deliberately cross-module read service (careful: must not become a second source of truth, must stay a projection over existing collections).
- **EventBus is underused as a signal source.** Only 6 of ~15 business services publish events. A Decision Engine or Insight generator would want far richer event coverage (expenses, communication sends/opens, catalog changes, subscription/entitlement events) before it can reason usefully.
- **No background/scheduled compute slot for AI or rules beyond the two cron-like schedulers (quote-expiry, invoice-overdue).** Both of those are narrow, single-purpose BullMQ repeatable jobs. A Decision Engine needs a generalized "periodic business-health sweep" shape, not a third copy-pasted scheduler.
- **AiPendingAction is scoped to chat-originated tool calls only** (`conversationId`-bound). Reusing it for system-generated recommendations would require either generalizing its schema or introducing a sibling entity — a real design decision, not a trivial extension.
- **apps/storefront's architecture (one template, path-routed, no CMS)** is a real ceiling on "Option A — créer un site" from §10; building a page-builder on top of it is a bigger lift than the other gaps.

## 5. Gaps UX / Produit

- Dashboard is KPI-first, not attention-first (§20 mismatch, detailed above).
- No Action Center anywhere in the nav (`apps/web/src/app/dashboard/layout.tsx`'s module nav: CRM, Catalogue, Réservations, Commandes, Devis & Factures, Workflows, Communication, Statistiques, Assistant IA — no "Centre d'Action").
- AI chat is a destination you visit, not a presence woven through the rest of the product (no "ask KORVA about this customer" entry point from a CRM detail page, for instance).
- Onboarding doesn't branch by business type.

## 6. Gaps d'intégration

- No Stripe/CinetPay/Paystack despite `PaymentProvider` abstraction being ready for them (only Flutterwave has a real adapter so far).
- No calendar integrations (Google/Outlook) — booking is KORVA-only.
- No outbound webhook subscription system for third parties (the brief's §9 "autres logiciels — API, webhooks" as something *external partners* subscribe to, distinct from the inbound webhook pipeline Wave 4 already built).
- No embeddable widget/SDK for external sites (see §3.7 above) — this is the single biggest integration gap relative to the brief, since §9–11 treat "connect my existing site" as a headline onboarding capability.
- No marketing/social platform integrations (explicitly lower priority per the brief's own section 9).

## 7. Gaps IA / Décision

- No Decision Engine (deterministic rules layer) distinct from the Workflow Engine.
- No background/proactive AI reasoning — every AI output today is a direct reply to a user's live message.
- No Recommendation entity/lifecycle.
- Confirmation-gated tools: only 1 of 19 (`cancel_booking`) plus the new WhatsApp consent flow — every other state-changing tool (`create_order`, `create_booking`, `create_quote`, `send_email`, `update_lead`, `create_task`) executes immediately. Expanding this gate is explicitly flagged as a known, deliberate gap in the codebase's own docs, not new information — but it's directly relevant to the brief's §6 ("l'IA ne doit jamais agir sans contrôle").
- No token-level AI usage/cost tracking (pre-existing gap, relevant if autonomous/background AI usage is about to increase materially).

## 8. Gaps Site Web / Connectivité

- `apps/storefront`: single generic template, no visual customization, no custom domains, path-based routing only.
- No "import my business from a URL" onboarding step.
- No JS widget/SDK for embedding KORVA capabilities (lead form, booking, checkout) into an externally-hosted site.
- No public API/webhook surface explicitly designed for *external software* to integrate with KORVA (the Wave 4 webhook pipeline is inbound-from-providers, not a general outbound integration surface for arbitrary third-party software per §9's "autres logiciels").

---

## 9. Roadmap d'implémentation priorisée

Ordered by: (1) unlocks the most other items, (2) uses data/infrastructure that already exists, (3) matches the brief's own emphasis that the *loop* matters more than any single module.

1. **Business Graph read layer** (backend only, additive, zero risk to existing modules) — a `GET /crm/contacts/:id/timeline`-style projection that assembles everything already cross-referenced (quotes, invoices, payments, bookings, orders, conversations, tasks) for one contact. This is the foundation every later item (Decision Engine, Action Center, AI context) reads from.
2. **Event coverage expansion** — wire the remaining business services (Expenses, Catalog, Communication, Subscriptions) to publish events, and add the two "vision-headline" events explicitly named in the brief: `customer.inactive` (computed by a new lightweight sweep, same shape as the existing quote-expiry/invoice-overdue schedulers) and richer payment/communication events.
3. **Decision Engine v1** — a small, deterministic rules layer (reuses Workflow's condition-evaluation code, but system-authored and business-health-focused rather than user-authored) that consumes the expanded event stream and the Business Graph, and writes a new `Recommendation` entity (status: `new → prepared → approved/rejected → executed`).
4. **Action Center** — the UI/API surface over `Recommendation` + existing `AiPendingAction` + workflow execution history + failed jobs. This is where the product starts *feeling* like an OS rather than a CRM, and it's mostly assembling things that already exist (workflow executions, queue health) plus the new Recommendation entity.
5. **AI ↔ Decision Engine integration** — let the AI read/explain Recommendations (level 2–3: observer/analyst), and let a chat request ("prepare a reactivation campaign") create one (level 4: prepare). Execution still goes through the existing, already-correct `AiPendingAction`-style approval gate.
6. **Expand AI confirmation coverage** beyond `cancel_booking`/WhatsApp — a known, already-documented gap, now more urgent once the AI can originate more actions via step 5.
7. **Vertical-aware onboarding** — configuration templates only (no schema change), lowest technical risk, high perceived-product-maturity payoff.
8. **External connectivity** — embeddable widget/SDK, then additional payment providers (CinetPay/Paystack), then calendar integrations.
9. **Storefront self-serve customization** — the biggest standalone lift in this list; sequence last because it's the least coupled to the "understands and runs the business" narrative the brief cares about most.

## 10. Première étape d'implémentation recommandée

**Start with the Business Graph read layer (item 1) scoped to a single endpoint: a per-contact timeline.** Reasoning:
- It's purely additive — no existing schema, controller, or test touches it, so zero regression risk to the 845+ currently-green e2e assertions.
- It's the one piece every later step (Decision Engine, Action Center, richer AI context) needs to read from, so building it first avoids redoing it under time pressure later.
- It's small enough to ship with full tests in one sitting, consistent with this project's own Definition of Done, and gives an immediately demonstrable product moment ("look, KORVA already knows everything about this customer") without yet committing to the larger, riskier design decisions (Recommendation entity shape, Action Center UX) that deserve more deliberate design first.
