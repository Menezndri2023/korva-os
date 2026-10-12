# KORVA OS — Production Readiness Audit

**Audit type:** Phase 13.0 — read-only production readiness audit.
**Scope:** Full monorepo (`apps/api`, `apps/web`, `apps/storefront`, `apps/worker`, `packages/*`, `infrastructure/`, `.github/`, `docs/`).
**Method:** Direct source inspection (schemas, controllers, services, guards, Dockerfiles, CI workflow, `.env.example`), cross-checked against `docs/security.md`, `docs/deployment.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/architecture.md`, `docs/database.md`, `docs/api.md`, `docs/ai.md`, `docs/architecture-decisions.md`, `docs/multi-tenancy.md`, and `README.md`. Claims in documentation were verified against code, not taken at face value. No code was modified as part of this audit.

> **⚠️ Read this before the rest of the document.** Sections 1–26 below are the **original Phase 13.0 audit**, written before the D4 hardening lots landed. Since it was written: `apps/worker` has been removed in favor of in-process BullMQ workers, Docker/CI have been hardened, and lots D4-A through D4-F have resolved several of the security findings this document originally flagged as open (including its stated basis for the NO-GO verdict in §25). **The original sections below are preserved as-is for historical traceability — do not treat their individual findings as current status.** [§27 — Phase 13.1 — Post-D4 Reconciliation](#27-phase-131--post-d4-reconciliation) documents the state of the repository as of `HEAD = 0f6a258a22b015b849dc42d3e215d4ce066a8f0f`. **Four further commits (Lots Q/R/S/T) have landed since** — [§28 — Post-Q/R/S/T Reconciliation](#28-post-qrst-reconciliation), at the end of this document, is the source of truth for the current state as of `HEAD = 0d1f289bc5337c26dfb636ae8eefb5aa8ae803dd`. §28 also covers the Payment/Refund reconciliation scheduler, which §27 omitted despite predating it.

---

## 1. Executive Summary

KORVA OS is a genuinely substantial, well-architected multi-tenant SaaS monolith. The engineering quality is notably high in the areas the team chose to build deeply: **multi-tenant data isolation, RBAC guard wiring, DTO validation, price-integrity on the public storefront, and the AI tool-calling orchestrator** are all implemented correctly and defensively, with evidence across ~150+ query sites and no cross-tenant IDOR found in the business data layer.

However, "12 phases complete, 109/109 e2e tests passing" describes *feature scaffolding and internal correctness*, not *production readiness*. Three categories of gap block a real launch:

1. **No real money movement anywhere.** Billing is 100% simulated — every org silently auto-subscribes to the free plan, plan changes are instant and free, and the only "payment provider" is a manual staff-entry stub. There is no Stripe/PSP integration, no checkout flow, no webhook receiver, and the `STRIPE_SECRET_KEY` env var is an unused, empty placeholder.
2. **No production infrastructure exists yet.** No hosting is provisioned, no production `docker-compose`/k8s manifests exist, CI never builds or runs the app's own Docker images (despite project history claiming otherwise — this claim is **verified false**), there is no error tracking, no structured logging, no metrics, no alerting, and `apps/worker` has no Dockerfile at all despite being a real deployable service.
3. **Authentication is incomplete for a real launch.** There is no password-reset flow, no email-verification flow, and no 2FA — all three are silently absent (not stubbed, not partially built, just missing). There is also a real privilege-escalation gap: an `ADMIN` can promote any member to `OWNER` with no hierarchy check.

None of this contradicts what the project's own documentation says — `docs/security.md`, `docs/api.md`, and `docs/ai.md` are unusually candid and self-report most of these gaps already. The IMPLEMENTATION_PLAN.md status banner at the top of the file is stale/self-contradictory (claims Phases 7–12 not started, while the body of the same document describes them as complete) and should be corrected as a documentation-hygiene item.

**Bottom line: NO-GO for production launch today.** The codebase is a strong beta/pilot candidate — suitable for a small number of trusted, non-paying design-partner tenants under close supervision — but not for public production traffic or real payment collection. See §25 for the full GO/NO-GO reasoning and §26 for the ordered path to GO.

---

## 2. Current Architecture

- **Monorepo:** pnpm workspaces (`apps/*`, `packages/*`), Node ≥22.6, no Turbo/Nx — plain `pnpm -r` scripts for build/lint/typecheck/test.
- **`apps/api`** — NestJS modular monolith. Modules: `identity` (auth, users, memberships, roles), `organizations`, `core` (tenant context, guards, config, events, counters), `crm`, `catalog`, `booking`, `commerce`, `finance`, `communication`, `workflow`, `subscriptions`, `ai`, `custom-fields`, `audit`, `public` (unauthenticated storefront API), `health`.
- **`apps/web`** — Next.js dashboard SaaS frontend (authenticated, per-org).
- **`apps/storefront`** — Next.js public storefront per organization slug, calling only `apps/api`'s `/public/*` endpoints.
- **`apps/worker`** — BullMQ worker skeleton. **Effectively dead code in the current architecture**: the real async job pipeline (EventBus → Workflow engine) runs *inside* `apps/api` (`core/events/event-bus.service.ts` + `workflow/events.processor.ts`), not in `apps/worker`. `apps/worker` only defines one placeholder email-queue processor that `console.log`s instead of sending anything, and is never enqueued to by `apps/api`. This is a documented architecture deviation (see `docs/architecture-decisions.md` ADR-005), not a hidden bug.
- **Database:** MongoDB via Mongoose, 37 schemas, all business collections scoped by `organizationId`.
- **Queue:** Redis + BullMQ, one active queue (`events`) run in-process inside `apps/api`.
- **Auth:** JWT access tokens (15 min TTL) + opaque, hashed, rotating refresh tokens stored server-side as `Session` documents. No cookies — Bearer-token only.
- **AI:** Single real provider (Anthropic, live HTTPS calls), 19 tools, 4 agent personas, tool-calling orchestration loop with per-tool permission checks and a human-confirmation gate for one sensitive tool (`cancel_booking`).
- **Billing:** Hardcoded 4-tier plan catalog, `EntitlementsService` for module/seat/usage gating, no real payment provider behind it.
- **Deployment target (declared, not yet built):** containerized, externally hosted (MongoDB Atlas, managed Redis, TBD compute) — no compose/k8s manifests wiring the 4 app images together currently exist.

---

## 3. What Is Actually Complete

| Area | Status | Evidence | Risk |
|---|---|---|---|
| Multi-tenant data isolation (12 business modules + AI + public API) | IMPLEMENTED | `core/tenant`, `memberships.service.ts:54-81`, ~150+ repository query sites all filter by `organizationId`; dedicated `tenant-isolation.e2e-spec.ts` (12 tests) | Low |
| JWT access + rotating refresh-token auth | IMPLEMENTED | `identity/auth/auth.service.ts`, hashed session tokens, real rotation/revocation | Low |
| RBAC guard chain (Jwt → Tenant → Permissions) | IMPLEMENTED | `app.module.ts:59-66`, applied globally via `APP_GUARD` | Low |
| DTO/query validation (Zod) | IMPLEMENTED | `ZodValidationPipe`, used in 27/28 controllers | Low (1 outlier: `notifications.controller.ts`) |
| Rate limiting (global + auth-specific) | IMPLEMENTED | `app.module.ts:41`, `auth.controller.ts:17-18` (120/min global, 30/min auth) | Medium (IP-based only, no account lockout) |
| CORS allowlist (not wildcard+credentials) | IMPLEMENTED | `main.ts:15-24`, explicit `CORS_ORIGINS` allowlist | Low, but shared between public and authenticated routes |
| Security headers (helmet) + compression | IMPLEMENTED | `main.ts:12-13` | Low |
| Global exception filter, no stack-trace leakage | IMPLEMENTED | `common/filters/http-exception.filter.ts` | Low (2 health endpoints bypass it, see §8) |
| API versioning (`/api/v1`) | IMPLEMENTED | `main.ts:25` | Low |
| Public storefront API scoping + server-side price re-verification | IMPLEMENTED | `public.service.ts` re-derives price from `Offer`, never trusts client totals | Low |
| AI tool-calling orchestrator, real LLM calls, tenant-scoped tools | IMPLEMENTED | `ai-orchestrator.service.ts`, `anthropic-ai.provider.ts` (real HTTPS calls) | Low |
| AI human-confirmation mechanism (infrastructure) | IMPLEMENTED | `AiPendingAction` flow, blocks execution until confirmed | Medium (only 1 of 19 tools uses it — see §11) |
| MongoDB compound indexes incl. `organizationId` | IMPLEMENTED | Present on nearly all 37 schemas | Low |
| Unique indexes correctly scoped per-org | IMPLEMENTED | `role`, `tag`, `custom-field`, `membership`, `order`/`invoice`/`quote` numbering, `usage` | Low |
| NoSQL injection resistance | IMPLEMENTED | All controller input passes through typed DTOs/Zod; no raw query-object spreading found | Low |
| Docker multi-stage builds for api/web/storefront, pnpm-workspace-aware | IMPLEMENTED | 3 Dockerfiles, correct filtered install/build | Medium (see §17 for gaps) |
| CI: install → typecheck → lint → build → unit → e2e, real Mongo+Redis service containers | IMPLEMENTED | `.github/workflows/ci.yml`, verified against file content | Low, but never confirmed to have actually run on GitHub (self-admitted in `docs/deployment.md`) |
| E2E test suite breadth (109 tests, 12 files, all domains + dedicated tenant-isolation suite) | IMPLEMENTED | Verified via grep: exactly 109 `it(`/`test(` blocks, matching the claimed count | Low |
| Health checks for DB and Redis (real pings, not static) | IMPLEMENTED | `health/health.controller.ts:24-59` | Low (leaks raw error text to unauthenticated callers — see §8) |
| Graceful shutdown logic in `apps/worker` (drains in-flight jobs) | IMPLEMENTED | `apps/worker/src/main.ts:17-25` | N/A (worker isn't deployed/used) |
| Checkout/booking price integrity on storefront frontend | IMPLEMENTED | `apps/storefront` sends only IDs/quantities, never trusts client-computed totals | Low |

---

## 4. What Is Missing

| Item | Status | Why Needed | Priority |
|---|---|---|---|
| Real payment provider integration (Stripe or similar) | NOT_IMPLEMENTED | No actual money can be collected; `ManualPaymentProvider` always returns `completed` instantly with no external call | **P0** |
| Payment webhook receiver + signature verification | NOT_IMPLEMENTED | No inbound webhook controller exists anywhere; no signature-verification pattern to reuse | **P0** |
| Subscription lifecycle states beyond `active`/`canceled` (trial, past_due, unpaid, incomplete) and enforcement of `currentPeriodEnd` | NOT_IMPLEMENTED | Every org stays `active` forever regardless of payment status; `canceled` is never actually set by any code path | **P0** |
| Production hosting/infrastructure provisioning (compute, DB, Redis, storage, DNS, TLS) | CONFIGURATION_REQUIRED | Nothing is provisioned; `docs/deployment.md` explicitly states this | **P0** |
| Password reset flow | NOT_IMPLEMENTED | No self-service account recovery; users permanently locked out on forgotten password | **P0** |
| Error tracking (Sentry or equivalent) | NOT_IMPLEMENTED | No visibility into production runtime errors | **P0** |
| Structured/centralized logging + log shipping | PARTIALLY_IMPLEMENTED | Mixed Nest Logger/`console.log`, no JSON structure, nothing shipped anywhere | **P0** |
| `apps/worker` Dockerfile / decision to remove or ship it | NOT_IMPLEMENTED | Currently undeployable dead code; either finish wiring it or formally retire it before prod | **P0** |
| Non-root Docker users + `HEALTHCHECK` instructions | NOT_IMPLEMENTED | All 3 Dockerfiles run as root, no container-level health probing | **P0** |
| Role-assignment privilege-escalation fix (ADMIN can grant OWNER) | NOT_IMPLEMENTED | `organizations.service.ts` `addMember` only checks the role belongs to the org, not a hierarchy | **P0** |
| Outgoing webhook SSRF hardening | NOT_IMPLEMENTED | `workflow-actions.service.ts` `callWebhook` performs raw `fetch()` with no IP/URL allowlist | **P0** |
| Email template HTML-injection fix | NOT_IMPLEMENTED | Unescaped `{{field}}` interpolation of public-submitted contact fields into outbound HTML email | **P0** |
| CI must actually build & smoke-test the 3 production Docker images | NOT_IMPLEMENTED | Project history claim of "Docker images built & started in CI" is verified false — CI only uses GH Actions service containers, never `docker build`s the app's own images | **P0** |
| API Keys (server-to-server auth) | NOT_IMPLEMENTED | No model/guard/strategy exists at all; needed for any real integration partner | P1 |
| 2FA / MFA | NOT_IMPLEMENTED | Explicitly a known gap; no schema field, no flow | P1 |
| Email verification flow | NOT_IMPLEMENTED | `emailVerifiedAt` field exists but is never set by any code path | P1 |
| File/object storage (uploads, logos, attachments) | NOT_IMPLEMENTED | No multer/S3/local storage anywhere; `Organization.logo`/`Offer.images` are bare strings (external URLs only) | P1 |
| Account lockout / brute-force protection beyond IP rate limiting | PARTIALLY_IMPLEMENTED | Only per-IP throttling exists; trivially bypassed with distributed IPs | P1 |
| MongoDB transactions for multi-document financial writes | NOT_IMPLEMENTED | Payment→Invoice and Order→Cart sequences are non-atomic; partial failure risk | P1 |
| BullMQ retry/backoff/DLQ configuration | NOT_IMPLEMENTED | Default `attempts: 1`, no backoff — a transient failure silently drops a job forever | P1 |
| TTL index on `Session.expiresAt` (and similar expiring records) | NOT_IMPLEMENTED | Expired sessions accumulate in Mongo forever, no auto-purge | P1 |
| Migration tooling | NOT_IMPLEMENTED | No `migrate-mongo`/custom runner; `infrastructure/scripts` is empty | P1 |
| Request ID / correlation ID propagation | NOT_IMPLEMENTED | No middleware exists; makes cross-service request tracing impossible | P1 |
| Metrics endpoint (Prometheus-style) | NOT_IMPLEMENTED | No `/metrics`, no `prom-client` | P1 |
| Real email provider active by default (currently defaults to log-only stub) | CONFIGURATION_REQUIRED | `RESEND_API_KEY` empty in `.env.example`; works once configured but ships inert | P1 |
| Real messaging provider (WhatsApp/SMS) | MOCKED | `LogMessagingProvider` only, no Twilio/WhatsApp Business API integration | P1 |
| Expand AI human-confirmation coverage beyond `cancel_booking` | PARTIALLY_IMPLEMENTED | State-changing tools (`create_order`, `send_email`, `send_whatsapp`, etc.) execute immediately with no confirmation gate | P1 |
| AI token-level usage tracking | NOT_IMPLEMENTED | Only coarse per-message count is tracked; Anthropic's `usage.input_tokens`/`output_tokens` are discarded, blocking cost-based billing | P1 |
| Custom/editable roles beyond the 6 hardcoded system roles | NOT_IMPLEMENTED | `RolesController` doesn't exist despite code comments describing the feature | P2 |
| Audit log read API | NOT_IMPLEMENTED | Writes are scoped correctly, but there is no endpoint to actually retrieve audit logs | P2 |
| Bull Board / queue monitoring dashboard | NOT_IMPLEMENTED | No visibility into queue depth/failures beyond console logs | P2 |
| Production `docker-compose.yml` or k8s manifests wiring all 4 app images together | NOT_IMPLEMENTED | Only a local-dev Mongo+Redis compose file exists | P2 |
| CORS policy split between public storefront routes and authenticated app routes | PARTIALLY_IMPLEMENTED | Both currently share one allowlist + `credentials:true` | P2 |
| Dependency vulnerability scanning (npm audit/Dependabot) | NOT_IMPLEMENTED | Self-admitted gap in `docs/security.md` | P2 |
| PDF generation for quotes/invoices | NOT_IMPLEMENTED | Self-admitted gap in `IMPLEMENTATION_PLAN.md` | P2 |
| Booking engine uses raw UTC instead of `Organization.timezone` | NOT_IMPLEMENTED | Self-flagged in ADR-004 as "to fix before real production use" | P2 |
| Init system (tini/dumb-init) in containers | NOT_IMPLEMENTED | No proper PID-1 signal handling/zombie reaping | P2 |
| Alerting | NOT_IMPLEMENTED | No monitoring stack exists yet to alert from | P2 |
| RAG / embeddings / vector storage for AI | NOT_IMPLEMENTED | Documented as "architecture-ready, not required for MVP" | P3 |
| Custom/per-tenant domains for storefront | NOT_IMPLEMENTED | Path-based routing only currently | P3 |
| Inventory/stock management on Offers | NOT_IMPLEMENTED | Self-admitted gap in `IMPLEMENTATION_PLAN.md` | P3 |
| IMPLEMENTATION_PLAN.md stale status banner (contradicts rest of document) | Documentation hygiene | Could mislead a reader into thinking Phases 7-12 aren't done when the same doc's body says they are | P3 |

---

## 5. Multi-Tenant Security Audit

**Overall verdict: [IMPLEMENTED] — the strongest area of the codebase.**

- **Tenant-context derivation is spoof-resistant.** The JWT carries only `userId`/`email`, never `organizationId` (`identity/strategies/jwt.strategy.ts:22`). The `X-Organization-Id` header is treated as a *hint only*; `TenantGuard` → `MembershipsService.resolveTenantContext` (`memberships.service.ts:54-81`) re-verifies a real, `active` membership exists in the database before attaching `request.tenant`. A client cannot select an arbitrary org by header manipulation.
- **Every one of the 12 in-scope business modules** (CRM, catalog, booking, commerce, finance, communication, workflow, subscriptions, custom-fields, plus AI and the public storefront) consistently filters Mongo queries — including `aggregate()` pipelines — by `organizationId`, sourced exclusively from `@CurrentTenant()`, never from client-supplied body/query/param values. Grepping every controller found **zero** instances of `organizationId` being read from anywhere other than the resolved tenant context.
- **Cross-entity reference validation:** e.g. `bookings.service.ts:38-58` validates that `contactId`/`offerId` referenced in a booking actually belong to the same org before allowing the booking — defends against cross-tenant ID guessing even where the ID format itself is valid.
- **AI tool layer is correctly isolated:** all 19 tools receive `organizationId` injected by the orchestrator (never accepted from the LLM's tool-call arguments), and every tool's underlying service call is org-scoped, so a prompt-injection attempt referencing another tenant's entity ID returns `NotFoundException`, not data.
- **Public storefront API** resolves `organizationId` exclusively from the (public, intentionally guessable-by-design) `:organizationSlug` route param via a plain DB lookup — never from client-supplied fields — and re-derives all pricing server-side.

**Findings (gaps, not active exploits):**
1. **Audit logs have no read API.** Writes are correctly org-scoped, but nothing can retrieve them via the API yet — cannot fully verify "isolated on read" because the read path doesn't exist. [P2]
2. **`apps/worker`'s email-queue placeholder has no `organizationId` in its job payload shape.** It currently does no data access (just logs), so this is not exploitable today — but if this dead code is ever wired to real sending/data access without adding tenant context to the job data, it would process without a tenant boundary. Recommend either deleting this dead code or adding `organizationId` to `EmailJobData` before any future use. [P1]
3. **Outgoing webhook `fetch()` (workflow action) has no SSRF hardening** — an authenticated org member configuring a workflow's webhook action can point it at internal infrastructure or a cloud metadata endpoint. Not a cross-tenant leak, but a real security gap in its own right. [P0 — see §8]
4. **File/upload storage does not exist**, so cross-tenant file access cannot yet be assessed either way. [N/A — flagged as unimplemented feature, not a leak]

**No cross-tenant IDOR, data leak, or bypassable guard was found anywhere in the business data layer.**

---

## 6. Authentication Security Audit

| Sub-area | Status | Notes |
|---|---|---|
| Login / Register | IMPLEMENTED | Argon2 hashing, generic invalid-credentials error (no user enumeration) |
| Password reset | **NOT_IMPLEMENTED** | No route, no token model — confirmed absent by direct grep |
| Email verification | **NOT_IMPLEMENTED** | `emailVerifiedAt` field exists but nothing ever sets it |
| Access tokens (JWT) | IMPLEMENTED | HS256, 15-min default TTL; `JwtStrategy.validate()` does not re-check the user still exists/is active — a JWT for a deleted/disabled user stays valid until natural expiry |
| Refresh tokens | IMPLEMENTED | Opaque 48-byte token, only SHA-256 hash persisted, true rotation on refresh |
| Revocation | IMPLEMENTED | Server-side session revocation on refresh/logout |
| Logout | PARTIALLY_IMPLEMENTED | Refresh session is revoked, but the already-issued access token remains valid until its 15-min TTL expires (standard JWT tradeoff, but no deny-list exists) |
| Brute-force / rate limiting | PARTIALLY_IMPLEMENTED | 30/min on login/register (tighter than global 120/min), IP-based only, no account lockout, no CAPTCHA |
| 2FA | **NOT_IMPLEMENTED** | No trace anywhere in the codebase |
| OAuth/SSO | NOT_IMPLEMENTED | Local email+password only (not currently required, informational) |
| JWT secrets | CONFIGURATION_REQUIRED | Read via `getOrThrow`, enforced at boot; `.env.example` ships obvious placeholders (`change-me-in-production`) that must be rotated before deploy |
| Dead required config | Hygiene issue | `JWT_REFRESH_SECRET` is required at boot (`env.validation.ts:5`) but **never actually read/used anywhere** — refresh tokens are opaque random bytes, not JWTs. Confirmed via grep: zero other usages. Should be removed or wired up to avoid operator confusion. |
| Cookies / CSRF | N/A | Pure Bearer-token auth, no cookies set by the API — shifts token-storage/XSS risk to the frontend (out of this audit's backend scope) |

---

## 7. Authorization / RBAC Audit

- **Guard chain** (`ThrottlerGuard → JwtAuthGuard → TenantGuard → PermissionsGuard`) is applied globally via `APP_GUARD` and consistently respected by every sampled controller; no route was found that skips a guard it should have.
- **6 fixed system roles** (`OWNER, ADMIN, MANAGER, SALES, FINANCE, STAFF`) with a hardcoded permission matrix, seeded per-org at creation. **Custom/editable roles are aspirational only** — no `RolesController` exists despite a code comment describing the intended feature.
- **Privilege-escalation gap (confirmed by direct code inspection):** `organizations.service.ts` `addMember` is gated by `settings.manage` (held by both `ADMIN` and `OWNER`) and only validates that the supplied `roleId` belongs to the org — it does **not** check that the inviting user's own role outranks the role being granted. An `ADMIN` can add a member as `OWNER`, achieving full ownership escalation with no additional check. **[P0]**
- `@Public()` and `@SkipTenant()` decorators were fully enumerated; every usage is appropriate (pre-auth routes, health checks, storefront, logout, plan listing, org creation) — no accidental exposure found.
- Two `@Public()` health endpoints (`/health/database`, `/health/redis`) leak the raw underlying error message to unauthenticated callers on failure, bypassing the app's otherwise-safe global exception filter — minor information disclosure. **[P2]**

---

## 8. API Security Audit

- **Validation:** Zod-based, applied per-route (not global), used consistently in 27 of 28 controllers. `notifications.controller.ts` is the one outlier — reads `page`/`limit` via raw `@Query()` + manual `Number()` coercion with no schema, unlike every other list endpoint. **[P2]**
- **Rate limiting:** Global 120/min per IP, 30/min on `/auth/login` and `/auth/register`. The unauthenticated, state-changing public storefront write endpoints (`createBooking`, `createOrder`) only get the global limit — no dedicated throttling or bot protection despite being open write endpoints reachable by anyone. **[P1]**
- **CORS:** Explicit allowlist via `CORS_ORIGINS`, `credentials: true`, correctly avoids the "reflect any origin" anti-pattern. However the same policy is shared by the public storefront routes and the authenticated/cookie-adjacent app routes — recommend splitting so a broadened public-storefront allowlist can never widen the authenticated surface. **[P2]**
- **Security headers:** `helmet()` + `compression()` applied globally, default config (no custom CSP). Acceptable for MVP, worth a CSP review before launch. **[P2]**
- **Error handling:** Global exception filter never leaks stack traces regardless of environment — the 2 health-check exceptions noted in §7 are the only bypass.
- **SSRF via outgoing webhooks:** `workflow-actions.service.ts` `callWebhook` performs `fetch(config.url, ...)` with **no validation** against internal/link-local addresses (`127.0.0.1`, `169.254.169.254` cloud metadata, private IP ranges), no DNS-rebinding protection, no scheme allowlist. Any org member able to configure a workflow action can use the API server's own network egress to probe internal infrastructure. **[P0 — must fix before production, since the API server will have real network access to real infrastructure at that point]**
- **Email HTML-injection:** `shared/template.ts` `interpolate()` performs plain string substitution with **zero HTML escaping**, confirmed by direct read of the function. Public storefront visitors control `contact.firstName`/`lastName` (via `POST /public/:slug/bookings|orders`) with no character restriction beyond length. When staff later reply via a message template referencing `{{contact.firstName}}`, that value is injected verbatim into outbound HTML email sent via Resend. This is real HTML/content injection into outgoing mail (phishing/link-injection risk to whoever receives the email), not classic in-app XSS. **[P0 — must fix before allowing any real public storefront traffic]**
- **API versioning:** `/api/v1` global prefix; Swagger docs gated to non-production via `NODE_ENV`.

---

## 9. API Keys Gap Analysis

**Status: [NOT_IMPLEMENTED] — confirmed by exhaustive grep, no model/guard/strategy exists.**

- Every "API key" reference found in the codebase is an *outbound* third-party credential (`AI_API_KEY` for Anthropic, `RESEND_API_KEY` for email) — nothing for authenticating *inbound* requests to KORVA's own API.
- **Where needed:** server-to-server integrations (partner CRM/ERP sync, headless third-party apps, future payment-provider callbacks originating from KORVA's own infra) — the existing `/public/*` routes already cover unauthenticated storefront use, so API keys are specifically for non-interactive, scoped, revocable machine credentials distinct from user JWTs.
- **What would need to be built:** an `ApiKey` Mongoose schema (hashed key + prefix, `organizationId`, scopes/permissions, `expiresAt`/`revokedAt`, `lastUsedAt`), a Passport strategy or custom guard parallel to `JwtStrategy`, and a way for the existing `TenantGuard`/`PermissionsGuard` to resolve a `TenantContext` from an API key (likely each key owning its own `roleId`/permission set rather than reusing a human membership).
- **Audit trail readiness:** `AuditLog` already records `organizationId` (required) and `userId` (optional). Extending it to also capture API-key identity is a small but real schema change — either a generalized `actorType: 'user' | 'apiKey'` + polymorphic actor ID, or an added optional `apiKeyId` field, since `AuditService.record()`'s current input type only accepts `userId?: string`.
- **Separately noted:** `auth.service.ts` never calls `AuditService.record()` for login/logout, even though `LOGIN`/`LOGOUT` are defined as valid `AUDIT_ACTIONS` — auth events are not currently audit-logged at all, independent of the API-key question. **[P2]**

---

## 10. Billing Gap Analysis

**Status: no real payment collection path exists anywhere in the system.**

- **Plan catalog:** [IMPLEMENTED] — 4 hardcoded tiers (free/starter/pro/business), idempotently seeded into Mongo.
- **Subscription lifecycle:** [PARTIALLY_IMPLEMENTED] — only 2 states modeled (`active`, `canceled`); `canceled` is never actually set by any code path. Every org is auto-provisioned to `active` on the free plan at creation with no payment step, and stays `active` forever regardless of `currentPeriodEnd` (nothing checks/enforces it).
- **EntitlementsService:** [IMPLEMENTED] but narrowly wired — real quota/module/seat enforcement logic exists, but is only actually called from 2 places app-wide (`organizations.service.ts` for modules/seats, `ai-orchestrator.service.ts` for AI message quota). Any new module route added later will **not** automatically respect plan restrictions unless explicitly wired.
- **Usage metering:** [PARTIALLY_IMPLEMENTED] — real atomic per-org/metric/month counters exist, but only `ai_messages_per_month` is ever recorded; no other business metric (bookings, orders, storage) is metered despite the data model being generic enough to support it.
- **Payment provider:** [MOCKED] — a clean `PaymentProvider` interface exists (`createPayment`/`verifyPayment`/`getPaymentStatus`/`refundPayment`), but the only implementation is `ManualPaymentProvider`, which always instantly returns `completed` with **no external call whatsoever**. No Stripe/CinetPay/Paystack/Flutterwave SDK dependency exists in the codebase despite their env-var placeholders being pre-declared in `.env.example`.
- **Webhooks:** [NOT_IMPLEMENTED] — no inbound payment-webhook controller exists at all; no signature-verification code exists anywhere to reuse.
- **What's needed to plug in a real provider (Stripe recommended given the existing interface shape):**
  1. Implement `StripePaymentProvider` against the existing `PaymentProvider` interface and swap the `PAYMENT_PROVIDER` DI binding in `finance.module.ts`.
  2. Build a webhook controller with raw-body signature verification (`STRIPE_WEBHOOK_SECRET` doesn't even exist in `.env.example` yet).
  3. Build a real checkout/payment-collection flow — the current system assumes payment is recorded *after the fact* by staff, not collected from the customer via hosted checkout.
  4. Build genuine recurring-billing sync (Stripe Subscription/Invoice objects, dunning/retry, proration on plan change — `changePlan` currently just resets the billing period unconditionally with no proration math).
  5. Expand the subscription status enum (`trial`, `past_due`, `incomplete`, `unpaid`) and add a scheduler to transition subscriptions at `currentPeriodEnd`.
  6. Add Stripe customer/subscription ID fields to the `Subscription`/`Organization` schemas (they don't exist today).

**This is a P0 blocker if any real revenue is expected at launch.**

---

## 11. AI Production Readiness

**Overall: the most mature subsystem outside of tenant isolation. Real, not mocked, in every dimension tested.**

- **Provider:** [IMPLEMENTED] — genuine HTTPS calls to `api.anthropic.com`, no hardcoded keys, correct tool-schema translation. Only one provider exists (Anthropic); no multi-provider fallback.
- **Orchestrator:** [IMPLEMENTED] — real agentic loop (max 5 tool iterations), full conversation persistence, per-tool permission checks, real audit logging of every executed tool call.
- **19 tools:** [IMPLEMENTED] — spot-checked and registry-reviewed; all delegate to real business services with real DB reads/writes (not canned responses), each with Zod input validation and a declared required permission.
- **4 agent personas:** [IMPLEMENTED] — distinct system prompts and tool allow-lists per agent; intentionally minimal pre-fetched context in favor of the tool-calling loop (documented design choice).
- **Human confirmation for sensitive actions:** [PARTIALLY_IMPLEMENTED] — the blocking mechanism itself is real (pending action persisted, execution deferred until explicit confirm/reject), but of 19 tools, **only `cancel_booking` is marked sensitive**. State-changing/customer-facing tools (`create_order`, `create_booking`, `create_quote`, `send_email`, `send_whatsapp`, `update_lead`, `create_task`) execute immediately with no human gate — worth expanding before letting the AI agent operate with less supervision. **[P1]**
- **Conversation/memory persistence:** [IMPLEMENTED] and correctly tenant-scoped (indexed by `organizationId`/`userId`).
- **RAG / embeddings / vector storage:** [NOT_IMPLEMENTED] — zero references anywhere; documented as a deliberate "architecture-ready, not required for MVP" choice, not an oversight.
- **Usage tracking / limits:** [PARTIALLY_IMPLEMENTED] — coarse per-message quota is real and tied to the subscription plan tier, but **token-level usage is discarded** (the Anthropic response's `usage.input_tokens`/`output_tokens` are never read or persisted), making cost-based billing or per-token throttling impossible with the current data model. **[P1]**
- **Cross-tenant isolation:** confirmed correct — see §5.

---

## 12. Database Production Readiness

- **Schemas & indexing:** [IMPLEMENTED] for the general case — 37 schemas, nearly all with `organizationId`-leading compound indexes matching real query patterns, and correctly scoped unique indexes (per-org, not global) where it matters. Two minor exceptions with only single-field indexes instead of compound (`fulfillment`, `refund`, `pipeline`) — low severity. **[P2]**
- **TTL indexes:** [NOT_IMPLEMENTED] — zero `expireAfterSeconds` usage anywhere. `Session.expiresAt` is an obvious, currently-unexploited TTL candidate; expired sessions accumulate in Mongo forever without a cleanup job. **[P1]**
- **Transactions:** [NOT_IMPLEMENTED] — zero `startTransaction`/`withTransaction` usage anywhere in the codebase. Two concrete multi-document write sequences are non-atomic and should be transactional: (1) Payment→Invoice (`payments.service.ts`, create payment then separately apply invoice delta), (2) Order creation→Cart conversion (`orders.service.ts`, a crash between the two steps can leave a cart open and an order created, enabling a duplicate order on retry). **[P1]**
- **Migrations:** [NOT_IMPLEMENTED] — no migration framework of any kind; `infrastructure/scripts` is an empty directory.
- **Seed:** lazy in-app idempotent seeding of the plan catalog only (self-healing design, safe for prod — no secrets baked in). No dev-user/dev-org seed exists, so no credential-leak risk.
- **N+1 patterns:** [PARTIALLY_IMPLEMENTED] — one real instance in cart checkout (`orders.service.ts`, fetching offers one-by-one instead of via `$in`), low severity given bounded cart sizes. No N+1 found in primary list/detail read paths.
- **NoSQL injection:** no unsanitized input reaching Mongo filters anywhere — all controller input passes through typed DTOs/Zod schemas first.

---

## 13. Redis/Queue Production Readiness

- **Active pipeline:** only one real, wired queue (`events`), running **inside `apps/api`**, not `apps/worker`. [IMPLEMENTED] but architecturally coupled to the API process rather than horizontally scalable as a separate worker fleet.
- **`apps/worker`:** [MOCKED / dead code] — declares 7 queue names, only 1 (`email`) has an actual `Worker` instantiated, and that handler is an explicit placeholder that only `console.log`s — no real email is ever sent through it (real email sending happens synchronously via `EmailProvider` inside `apps/api`, not through this queue). `apps/api` never enqueues to any of `apps/worker`'s queues. **This entire app is currently non-functional and should either be finished or formally retired before production.** **[P0]**
- **Retry/backoff/DLQ:** [NOT_IMPLEMENTED] — `EventBusService.queue.add()` passes no `JobsOptions`, so BullMQ defaults apply: `attempts: 1`, no backoff, no dead-letter handling. A single transient failure permanently drops a workflow-triggered job with no retry and no operator visibility. **[P1]**
- **Idempotency:** [NOT_IMPLEMENTED] — no dedup/idempotency-key logic in job processing; low risk today only because `attempts: 1` makes accidental retries unlikely, but this becomes a real double-execution risk the moment retries are added without also adding idempotency.
- **Concurrency:** defaults only (concurrency 1) — the workflow pipeline processes strictly serially.
- **Graceful shutdown:** [IMPLEMENTED] in `apps/worker/src/main.ts` (correct SIGTERM/SIGINT drain pattern) — moot until this app is actually deployed.
- **Redis connection config:** [CONFIGURATION_REQUIRED] — `apps/api` fails fast if `REDIS_URL` is missing (`getOrThrow`); `apps/worker` silently falls back to `localhost:6379` if missing, a real prod misconfiguration risk if this app is ever deployed. No TLS/auth enforced in code — entirely dependent on the `REDIS_URL` scheme/credentials supplied at deploy time. Local `docker-compose.yml` runs Redis with no password at all (fine for local dev, must not be replicated in prod).
- **Health check for Redis:** [IMPLEMENTED] but wasteful — creates a brand-new `IORedis` client on every health-check request instead of reusing a shared connection. **[P3]**

---

## 14. File Storage Readiness

**Status: [NOT_IMPLEMENTED] — the feature does not exist.**

No multer, no S3/R2/GCS SDK, no local-disk storage path, no GridFS anywhere in the codebase. `Organization.logo` and `Offer.images` are plain string(s) fields, presumably intended for externally-hosted URLs pasted in by users rather than actual uploads. There is nothing to assess for path-traversal, filename sanitization, virus scanning, or signed-URL access control because the upload endpoint itself does not exist. **Any product requirement involving logo/document/attachment uploads is entirely unbuilt.** **[P1]**

---

## 15. Email Readiness

- **Provider:** [PARTIALLY_IMPLEMENTED] — a real `ResendEmailProvider` exists and makes genuine HTTP calls to the Resend API, but the system **defaults to a log-only stub** (`LogEmailProvider`) unless `EMAIL_PROVIDER=resend` and `RESEND_API_KEY` is set. In the current `.env` state, the key is empty, so out of the box the system runs in mock mode. **[P1 — must set `RESEND_API_KEY` and verify `EMAIL_PROVIDER=resend` before launch]**
- **Templates:** [NOT_IMPLEMENTED safely] — `interpolate()` performs zero HTML escaping. Combined with public-submitted contact fields flowing into staff-sent template emails, this is a confirmed HTML-injection vector into outbound mail. **[P0 — see §8]**
- **Internal notifications:** [IMPLEMENTED] — fully separate in-app/DB notification system, no email/push fanout tied to it.
- **SMS/WhatsApp:** [MOCKED] — `LogMessagingProvider` only, no real Twilio/WhatsApp Business API integration exists.
- **Deliverability (SPF/DKIM):** not addressed in code (expected — this is a DNS/provider-dashboard concern, not application code). **[Configuration required at DNS layer before launch]**

---

## 16. Payment Readiness

See §10 for full detail. Summary status: **[MOCKED]** end-to-end. No real payment gateway, no webhook receiver, no checkout flow, no recurring billing sync. `STRIPE_SECRET_KEY` and 3 other PSP env vars are pre-declared in `.env.example` but entirely unused in code — forward-declared placeholders for unbuilt functionality, not evidence of partial implementation. **[P0]**

---

## 17. Docker Production Readiness

| Sub-area | Status |
|---|---|
| Multi-stage builds, pnpm-workspace-aware (api/web/storefront) | IMPLEMENTED |
| Filtered install/build per app | IMPLEMENTED |
| `apps/worker` Dockerfile | **NOT_IMPLEMENTED** (missing entirely, despite being a real deployable service in principle) |
| Next.js `output: "standalone"` | NOT_IMPLEMENTED — deliberate, documented workaround instead (pnpm-symlink/`@swc/helpers` tracer bug), full `node_modules` copied instead; larger images, working build |
| Non-root `USER` in final stage | **NOT_IMPLEMENTED** — all 3 Dockerfiles run as root |
| `HEALTHCHECK` instruction | **NOT_IMPLEMENTED** — none of the 3 Dockerfiles have one, despite real health endpoints existing in `apps/api` that could be pointed at |
| Init system (tini/dumb-init) / signal handling | **NOT_IMPLEMENTED** — bare `CMD`, no PID-1 signal forwarding/zombie reaping |
| Secrets baked into image at build time | Correctly avoided — only a public client URL is a build `ARG`, all real secrets are runtime env |
| Production `docker-compose`/k8s manifests wiring the 4 images together | **NOT_IMPLEMENTED** — the only compose file stands up local-dev Mongo+Redis only |

**All 4 non-root/HEALTHCHECK/init gaps are P0** — a production container fleet should not run as root, should self-report health to the orchestrator, and should handle signals correctly for zero-downtime deploys.

---

## 18. CI/CD Readiness

- **Trigger:** push to `main` + all PRs. [IMPLEMENTED]
- **Steps:** checkout → pnpm/node setup → `pnpm install --frozen-lockfile` → typecheck → lint → build → unit test → e2e test, against real MongoDB 7 + Redis 7 **GitHub Actions service containers**. All steps are genuine and block on failure. [IMPLEMENTED]
- **Claim verification — "Docker images réellement construites et démarrées avec MongoDB + Redis" — VERIFIED FALSE.** The workflow contains no `docker build`, no `docker-compose`, no reference to any of the repo's own Dockerfiles anywhere. MongoDB/Redis ARE started, but as GitHub Actions native service containers backing the Nest test run directly on the runner — not as this repo's built application images. This claim as stated in project history conflates two different things and does not hold up under direct inspection of `.github/workflows/ci.yml`. **[P0 — must build and smoke-test the actual production images in CI before this can be trusted for deploys]**
- **Deployment steps:** none exist — no staging/production job, no cloud CLI invocation of any kind. CI is test/build-verification only. **[P0 if continuous deployment is desired at launch, otherwise P1]**
- **Secrets:** no `secrets.*` usage yet (none needed — all CI env values are hardcoded ephemeral dummy credentials, appropriately scoped to CI only).
- **Migrations/rollback/smoke tests:** none exist. **[P1]**
- **Unverified claim:** `docs/deployment.md` itself states the CI workflow has never actually been executed on GitHub — only manually reviewed/reproduced locally. This should be independently confirmed (a real run on `main`) before relying on it as a production gate. **[P0]**

---

## 19. Monitoring & Observability

| Sub-area | Status |
|---|---|
| Structured (JSON) logging | **NOT_IMPLEMENTED** — Nest's default console-text `Logger` mixed with raw `console.log`, no pino/winston, no log levels/transport config |
| Request ID / correlation ID | **NOT_IMPLEMENTED** — no middleware anywhere |
| Error tracking (Sentry or equivalent) | **NOT_IMPLEMENTED** — zero references anywhere in the codebase or dependencies |
| Health endpoints | IMPLEMENTED — real DB/Redis pings, not wired to any container `HEALTHCHECK` or orchestrator probe yet |
| Metrics (`/metrics`, Prometheus) | **NOT_IMPLEMENTED** |
| Queue monitoring (Bull Board or similar) | **NOT_IMPLEMENTED** — only raw `worker.on("failed", ...)` console logging |
| Alerting | **NOT_IMPLEMENTED** — expected, since no monitoring stack exists yet to alert from |

**All of the above are P0/P1 for any production launch** — without error tracking and structured logging, production incidents will be effectively invisible until a customer reports them.

---

## 20. DNS / Domain / SSL Requirements

Not addressed anywhere in the codebase (correctly out of scope for application code). Required before launch:
- A production domain for `apps/web` (dashboard), a domain/wildcard-or-path strategy for `apps/storefront` (per-organization public sites — currently path-based only, no subdomain/custom-domain support built), and a domain for `apps/api`.
- TLS certificates for all of the above (typically automatic via the chosen hosting/CDN provider).
- DNS records: standard A/CNAME for the above, plus SPF/DKIM/DMARC records for the email-sending domain (Resend) to ensure deliverability and reduce phishing risk given the template-injection issue noted in §8/§15.
- If a CDN/WAF is used in front of `apps/web`/`apps/storefront`, its config is entirely unaddressed in-repo — external decision.

---

## 21. Required Environment Variables

*(Names only — no values shown, per audit instructions.)*

**Core / infra:**
`NODE_ENV`, `PORT`, `APP_URL`, `API_URL`, `STOREFRONT_URL`, `CORS_ORIGINS`, `NEXT_PUBLIC_API_URL`, `MONGODB_URI`, `REDIS_URL`

**Auth:**
`JWT_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_SECRET` *(currently declared/enforced but unused in code — see §6)*, `JWT_REFRESH_TTL`

**Storage (declared, unused — feature not built):**
`STORAGE_PROVIDER`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`

**Email:**
`EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM`

**Payments (declared, unused — feature not built):**
`STRIPE_SECRET_KEY`, `CINETPAY_API_KEY`, `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY`
*(Additionally needed once real payments are built: a Stripe webhook signing secret — does not exist in `.env.example` yet.)*

**AI:**
`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`

**Messaging (declared, unused — feature is a log-only stub):**
`WHATSAPP_API_KEY`

**Worker-specific (has no `.env` awareness of its own beyond this):**
`REDIS_URL` *(read directly via `process.env`, with an unsafe `localhost` fallback default — see §13)*

---

## 22. External Services Required

| Service | Purpose | Required? | Current Integration Status | Configuration Needed |
|---|---|---|---|---|
| MongoDB (Atlas or self-managed) | Primary datastore | Yes | Code-ready (Mongoose), no managed instance provisioned | Provision cluster, connection string, backups, IP/VPC access |
| Redis (managed) | BullMQ queue backend | Yes | Code-ready, local-only compose exists | Provision managed instance with auth/TLS, connection string |
| Resend (or alternative ESP) | Transactional email | Yes | Code-ready but inactive by default (no key set) | Set `RESEND_API_KEY`, verify sending domain, SPF/DKIM |
| Anthropic API | AI Gateway provider | Yes (for AI features) | Fully wired, real calls | Set `AI_API_KEY`, monitor spend (no token-cost tracking exists yet — §11) |
| Stripe (or chosen PSP) | Real payment collection | Yes (for any revenue) | **Not integrated at all** — interface exists, no implementation | Full integration build required — see §10 |
| Object storage (S3/R2/GCS) | File/logo/attachment uploads | Yes (feature not built) | **Not integrated at all** | Full feature build required — see §14 |
| WhatsApp Business API / Twilio | Real SMS/WhatsApp messaging | Only if this channel is required at launch | Mocked (log-only) | Full integration build required |
| Sentry (or equivalent) | Error tracking | Yes | Not integrated | Add SDK, DSN config, source maps |
| Log aggregation (e.g. Datadog/Better Stack/CloudWatch) | Centralized structured logs | Yes | Not integrated — logs currently go to stdout only | Add structured logger + shipping |
| Hosting/compute for `apps/api`, `apps/worker` (if kept) | Backend runtime | Yes | Docker images build for api; none for worker | Choose platform (e.g. Fly.io/Render/ECS/Cloud Run), provision |
| Hosting for `apps/web`, `apps/storefront` | Frontend runtime | Yes | Docker images build (non-standalone, heavier) | Choose platform, or reconsider standalone mode fix |
| DNS provider | Domain routing | Yes | Not provisioned | Purchase/configure domains, records |
| CDN/WAF (optional but recommended) | Edge caching, DDoS/bot mitigation | Recommended | Not addressed | Evaluate need given public storefront write endpoints (§8) |

---

## 23. Production Deployment Architecture

A concrete, minimal-but-real target architecture consistent with what the codebase is actually built to support today:

```
                         ┌─────────────────────┐
                         │        DNS/TLS        │
                         │  (domain + certs per   │
                         │   app.web/api/store)   │
                         └─────────┬─────────────┘
                                   │
                 ┌─────────────────┼─────────────────────┐
                 │                 │                       │
        ┌────────▼──────┐ ┌────────▼───────┐   ┌───────────▼──────────┐
        │  apps/web      │ │  apps/storefront│   │  apps/api             │
        │  (Next.js,     │ │  (Next.js,      │   │  (NestJS, containerized,│
        │  containerized)│ │  containerized) │   │  behind LB, 2+ replicas)│
        └────────┬───────┘ └────────┬────────┘   └───────────┬──────────┘
                  │                  │                         │
                  └────────┬─────────┘                         │
                            │        (both call apps/api only)  │
                            └─────────────────┬──────────────────┘
                                               │
                    ┌──────────────────────────┼──────────────────────────┐
                    │                          │                          │
           ┌────────▼────────┐      ┌──────────▼─────────┐     ┌──────────▼─────────┐
           │ MongoDB Atlas    │      │ Managed Redis        │     │ Object storage       │
           │ (primary DB,     │      │ (BullMQ backend,     │     │ (S3/R2 — once file   │
           │ backups enabled) │      │ TLS + auth enabled)  │     │ upload feature built) │
           └──────────────────┘      └───────────────────────┘     └───────────────────────┘

           External services called by apps/api at runtime:
           - Anthropic API (AI)
           - Resend API (email)
           - Stripe (once billing is built)
           - Sentry (error tracking, once added)
           - Log shipping target (once structured logging is added)

Note: apps/worker is currently dead/unwired. Recommendation is to either (a) formally
retire it and keep the event/workflow pipeline running in-process inside apps/api as it
does today (simpler, matches current reality), or (b) actually finish wiring it as a
horizontally-scalable separate deployment if job volume grows — this is an architectural
decision to make explicitly, not an accidental gap to silently carry forward.
```

Key architectural decision needed before infra provisioning: **decide now whether `apps/worker` is being kept or retired.** Building infrastructure (a Dockerfile, a deployment, autoscaling) for a service that currently does nothing real would be wasted effort; conversely, deploying to production without deciding leaves 6 of 7 declared queues silently non-functional with no one having made that call on purpose.

---

## 24. Production Checklist

**P0 — must complete before any production launch:**
- [ ] Integrate a real payment provider (Stripe recommended) — provider implementation, checkout flow, webhook receiver with signature verification
- [ ] Expand subscription lifecycle states and add expiry/dunning enforcement
- [ ] Provision production MongoDB, Redis, hosting for `apps/api`/`apps/web`/`apps/storefront`
- [ ] Decide keep-vs-retire for `apps/worker`; if kept, build its Dockerfile and wire real queues; if retired, remove it
- [ ] Implement password-reset flow
- [ ] Fix the `ADMIN`-can-grant-`OWNER` privilege-escalation gap in `organizations.service.ts`
- [ ] Add SSRF hardening to the outgoing webhook `fetch()` call in `workflow-actions.service.ts`
- [ ] Add HTML escaping to `interpolate()` / sanitize public-submitted contact fields before they reach outbound email templates
- [ ] Make CI actually build and smoke-test the 3 production Docker images (not just service-container-backed tests); confirm a real run on `main` succeeds
- [ ] Add `USER` (non-root) and `HEALTHCHECK` to all Dockerfiles; add a minimal init system for signal handling
- [ ] Integrate error tracking (Sentry or equivalent)
- [ ] Implement structured logging with shipping to a log aggregator
- [ ] Provision DNS + TLS for all public-facing domains
- [ ] Set real `RESEND_API_KEY` (or chosen ESP) and configure SPF/DKIM/DMARC
- [ ] Rotate all placeholder secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, etc.) to real production values

**P1 — necessary before public beta:**
- [ ] Implement API Keys (model, guard, audit-trail extension)
- [ ] Implement 2FA
- [ ] Implement email verification
- [ ] Implement file/object storage for uploads
- [ ] Add account-level brute-force protection beyond IP rate limiting
- [ ] Wrap Payment→Invoice and Order→Cart writes in MongoDB transactions
- [ ] Configure BullMQ retry/backoff/DLQ policy; add idempotency guards before increasing `attempts`
- [ ] Add TTL index on `Session.expiresAt`
- [ ] Stand up a migration tool and write the first real migration
- [ ] Add request/correlation ID middleware
- [ ] Add a metrics endpoint
- [ ] Activate a real messaging provider or explicitly descope WhatsApp/SMS for launch
- [ ] Expand AI human-confirmation coverage to other state-changing tools
- [ ] Persist AI token-level usage for cost tracking
- [ ] Add rate limiting specifically to public storefront write endpoints
- [ ] Remove or wire up the dead `JWT_REFRESH_SECRET` config requirement

**P2 — important after beta:**
- [ ] Build a custom/editable roles API
- [ ] Build an audit-log read API
- [ ] Add Bull Board or equivalent queue monitoring
- [ ] Write a production `docker-compose`/k8s manifest set
- [ ] Split CORS policy between public and authenticated routes
- [ ] Add dependency vulnerability scanning to CI
- [ ] Fix booking engine to use `Organization.timezone` instead of raw UTC
- [ ] Add compound indexes to `fulfillment`/`refund`/`pipeline` schemas
- [ ] Fix the stale status banner at the top of `IMPLEMENTATION_PLAN.md`
- [ ] Add audit logging to login/logout events

**P3 — future improvements:**
- [ ] RAG/embeddings for AI
- [ ] Custom/per-tenant storefront domains
- [ ] Inventory/stock management on Offers
- [ ] PDF generation for quotes/invoices
- [ ] Reuse a shared Redis client in the health check instead of creating a new one per request

---

## 25. GO / NO-GO Assessment

# NO-GO

KORVA OS is **not ready for a production launch handling real customers or real payments today.** The reasoning:

1. **There is no way to collect money.** A SaaS platform whose entire billing layer is a simulation (auto-active subscriptions, no payment provider, no webhook receiver) cannot generate revenue or enforce paid-tier restrictions in any real sense. This alone is disqualifying for anything beyond a free pilot.
2. **There is no production infrastructure.** Nothing is hosted, DNS/TLS is unconfigured, and CI does not build or verify the actual deployable Docker images — the specific claim that Docker images are "really built and started" in CI does not hold up against the workflow file's contents.
3. **There are real, concrete security gaps that would be irresponsible to expose to the public internet as-is:** an unauthenticated-reachable outgoing-webhook SSRF vector, unescaped HTML injection into outbound email sourced from public storefront input, and a privilege-escalation path allowing an Admin to self-promote to Owner.
4. **There is no operational visibility.** Without error tracking or structured logging, a production incident would be discovered by a customer complaint, not by the team.
5. Users also cannot recover a forgotten password — a baseline expectation for any consumer- or business-facing product.

**What is genuinely strong and should not be re-litigated:** the multi-tenant data isolation model, the RBAC guard chain, the AI tool-calling architecture, and the public storefront's price-integrity design are all production-grade already and do not need to be redone — they need to be built *around*, not replaced.

**A conditional GO exists today** for a narrow scope: a closed pilot with a small number of trusted, non-paying design-partner organizations, run under direct engineering supervision, with the P0 security items (SSRF, email injection, privilege escalation) fixed first regardless of audience size, since those are cheap to fix and dangerous to leave even in a pilot.

---

## 26. Recommended Next Steps

In order:

1. **Fix the four cheap-but-serious security items first, regardless of what's decided next** (privilege escalation in `addMember`, SSRF in `callWebhook`, HTML injection in `interpolate()`, dead-code/tenant-context gap in `apps/worker`'s email queue). These are small, contained changes with outsized risk reduction.
2. **Make the keep-vs-retire call on `apps/worker`** — this decision blocks both the Docker/CI work and the queue-hardening work below it, so resolve it before investing further in either direction.
3. **Stand up real infrastructure in a staging environment first**: MongoDB Atlas, managed Redis, hosting for the 4 (or 3, if worker is retired) apps, DNS+TLS for a staging domain. Prove the actual Docker images build and run correctly outside of local dev before trusting any of the deployment-readiness claims.
4. **Fix CI to build and smoke-test the real production images** against that staging infrastructure — this both closes the current false claim and gives you a repeatable deploy gate.
5. **Add error tracking and structured logging** before doing anything else customer-facing — you want visibility into staging before you need it in production.
6. **Build the real payment integration** (Stripe recommended) end-to-end: provider implementation → webhook receiver → checkout flow → subscription lifecycle states → proration/dunning. This is the largest single piece of remaining work and should be scoped as its own project phase.
7. **Close the authentication gaps**: password reset, email verification, then 2FA.
8. **Harden the queue layer**: decide retry/backoff policy, add idempotency guards, add the missing TTL index, wrap the two flagged multi-document writes in transactions.
9. **Build file/object storage** if any launch requirement depends on uploads (logos, attachments) — currently a hard blocker for those specific features only.
10. **Re-run this audit (or an equivalent focused review) after the P0 list in §24 is complete**, before flipping the switch to real production traffic.

---

## 27. Phase 13.1 — Post-D4 Reconciliation

### 27.1 Scope and date of reconciliation

- **Repository:** `korva-os` monorepo.
- **Branch:** `main`.
- **HEAD at time of reconciliation:** `0f6a258a22b015b849dc42d3e215d4ce066a8f0f`.
- **Nature:** post-D4 reconciliation — not a fresh independent audit. This section exists to reconcile the original Phase 13.0 findings (§1–§26 above) with what is actually present in the repository today, after lots D4-A through D4-F (and the earlier, separate Docker/CI hardening and `apps/worker` removal) landed.
- **Objective:** give a reader an accurate, self-contained picture of current status without requiring them to reconstruct the intervening git history themselves.

### 27.2 Removal of `apps/worker`

`apps/worker` no longer exists in this repository. It was removed by commit `c33edd6` ("chore: remove apps/worker (superseded by in-process BullMQ workers)"), which predates all of the D4 lots. The event/workflow pipeline (event bus → `EventsProcessor` → `WorkflowEngineService`) runs entirely in-process inside `apps/api`, as it already did before the removal — `apps/worker` had been dead/unwired code (only a placeholder `email` queue that logged instead of sending), and removing it did not change the pipeline's actual runtime behavior.

Practical consequence: the "keep vs retire `apps/worker`" decision that the original audit (§4, §17, §23, §24, §26) presents as open and blocking is **not open** — it was already made (retire) and executed before this reconciliation. Every reference to `apps/worker` in §1–§26 above (architecture description, Dockerfile gap, environment variables, the deployment diagram, the P0 checklist item, recommendation #2) should be read as **historical context describing a component that has since been deleted**, not as a description of the current codebase.

### 27.3 Docker / CI

**Docker.** All three production Dockerfiles currently include both a non-root `USER` directive and a `HEALTHCHECK` instruction:
- `apps/api/Dockerfile` — `USER node` (line 53), `HEALTHCHECK` (line 62)
- `apps/web/Dockerfile` — `USER node` (line 56), `HEALTHCHECK` (line 63)
- `apps/storefront/Dockerfile` — `USER node` (line 51), `HEALTHCHECK` (line 58)

**CI.** `.github/workflows/ci.yml` contains a dedicated `docker-build` job that builds all three production images via `docker/build-push-action@v6` (using each app's real Dockerfile) and smoke-tests each one via `docker run` / `docker logs` / `docker stop`.

Both of the above were introduced by commit `b34b5ba` ("chore: production Docker images + CI hardening (MongoDB replica set, docker-build smoke tests)"), which — like the `apps/worker` removal — predates the D4 lots.

**Important nuance:** this reconciliation confirms that CI builds and smoke-tests the real production images. It does **not** confirm that this workflow has actually executed successfully on GitHub, and it is **not** evidence of an actual production deployment. "CI builds and boots the images locally in a GitHub Actions runner" and "the application is deployed and running in production" are two different claims — only the first is verified here. §27.7 and §27.8 below reflect this distinction; deployment/infrastructure provisioning remains an open item.

### 27.4 D4-A through D4-F: corrections applied

| Lot | Finding initial (§ reference) | État post-D4 | Commit(s) |
|---|---|---|---|
| D4-A | Privilege escalation via `addMember` — an ADMIN could grant OWNER with no hierarchy check (§7, §4 line 82) | `RESOLVED` | `bdeca5b` |
| D4-B | `notifications.controller.ts` read `page`/`limit` via raw `@Query()` + manual `Number()`, no schema (§8, §4) | `RESOLVED` | `0970d57` |
| D4-C | `interpolate()` performed zero HTML escaping — HTML/content injection into outbound email (§8, §15) | `RESOLVED` | `6ba0016` |
| D4-D1 + D4-E | `callWebhook` performed raw `fetch()` with no SSRF hardening (§4 line 83, §5 finding 3, §8) | `RESOLVED` | `1816d16`, `0fdb447` |
| D4-F | `/health/database` and `/health/redis` leaked the raw underlying error message to unauthenticated callers (§3 line 63, §7 line 164) | `RESOLVED` | `0f6a258` |

For D4-C and D4-D1/D4-E specifically: the fix in each case was applied in two steps — a capability was added first (`escapeHtml` option on `interpolate()`; the `safeFetch` helper), then wired into the actual call site that mattered (`sendEmail`'s email body, `callWebhook`'s outgoing request) in a follow-up commit. Both steps are listed together above since neither alone constitutes the fix.

For D4-F: internal error detail (stack, connection string fragments, hostnames) is now logged server-side only, via the Nest `Logger`, and never included in the HTTP response body. The public response body is now a fixed, generic message per dependency (`'Database is currently unavailable'` / `'Redis is currently unavailable'`) with a stable error code.

### 27.5 Historical findings now resolved

The following items, as stated in §1–§26 above, are no longer accurate descriptions of the current codebase and must not be treated as open blockers:

- Privilege escalation in `addMember` — see `bdeca5b` (§27.4).
- SSRF in `callWebhook` — see `1816d16` / `0fdb447` (§27.4).
- HTML injection in `interpolate()` — see `6ba0016` (§27.4).
- Raw error-message leakage on `/health/database` and `/health/redis` — see `0f6a258` (§27.4).
- Missing Zod validation on `notifications.controller.ts` pagination — see `0970d57` (§27.4).
- The "keep `apps/worker` or retire it" open decision — already retired, see `c33edd6` (§27.2).
- Docker containers running as root (no non-root `USER`) — see `b34b5ba` (§27.3).
- Missing Docker `HEALTHCHECK` instructions — see `b34b5ba` (§27.3).
- CI not building/smoke-testing the real production Docker images — see `b34b5ba` (§27.3).

### 27.6 Tests

The repository currently contains **15 files matching `*.e2e-spec.ts`** in `apps/api/test/`, containing **159 `it`/`test` blocks** in total according to a static grep count performed during this reconciliation — this is a count of test-block occurrences in source, not a report of a test run. Separately, `apps/api/src/` currently contains **11 files matching `*.spec.ts`**, and running the full unit test suite (`pnpm --filter @korva/api test`) during the D4 audits produced **107/107 tests passing** — this figure is a real executed-test result, distinct from the static e2e block count above. The original audit's §3 claim of "109 tests, 12 files" for the e2e suite predates the D4 lots (several of which added new e2e/unit spec files and test cases) and should be read as a historical snapshot, not current numbers.

### 27.7 Findings still open

**Production / infrastructure**
- No demonstrated provisioning of production infrastructure (managed MongoDB, managed Redis, hosting for `apps/api`/`apps/web`/`apps/storefront`, DNS/TLS) — nothing in the repository can confirm this exists.
- No evidence of an actual production deployment having occurred — CI building and smoke-testing images locally (§27.3) is not deployment.
- No monitoring/error-tracking integration (e.g. Sentry) — confirmed absent by direct search during this reconciliation.

**Billing**
- No real payment collection path — confirmed unchanged during this reconciliation (`SubscriptionStatus` remains `["active", "canceled"]`, no Stripe/PSP SDK dependency found).
- No PSP (Stripe or otherwise) actually integrated.

**Auth / account lifecycle**
- No password-reset flow — confirmed absent by direct search during this reconciliation.
- No 2FA/MFA.
- No email-verification flow (the `emailVerifiedAt` field exists but nothing sets it) — not independently re-verified during this reconciliation, carried forward from the original audit.

**Storage**
- No object/file storage integration — confirmed absent by direct search during this reconciliation.

**Queue**
- `EventBusService.publish()` still calls `queue.add(name, data)` with no `JobsOptions` — retry/backoff/DLQ policy remains unconfigured (BullMQ default `attempts: 1`), confirmed by direct read during this reconciliation. This was outside the scope of every D4 lot.

**Redis health check**
- `HealthController.redis()` still constructs a new `IORedis` client on every call rather than reusing a shared connection — confirmed unchanged; D4-F only changed the error-handling/message behavior of this endpoint, not its connection strategy. Low severity, as originally noted (§13, §24 P3).

**Configuration**
- `JWT_REFRESH_SECRET` remains a required boot-time config value (`env.validation.ts`) with no actual code path reading it — carried forward from the original audit, not independently re-verified during this reconciliation.

**Rate limiting**
- Coverage of public storefront write endpoints beyond the global per-IP limit was not independently re-verified during this reconciliation; carried forward from the original audit as a plausible still-open gap.

### 27.8 GO / NO-GO reassessment

**Verdict: NO-GO** (unchanged from the original audit) — but the reasoning is corrected.

**No longer valid as justification for NO-GO:**
- Privilege escalation in `addMember` — resolved.
- SSRF in `callWebhook` — resolved.
- HTML injection in `interpolate()` — resolved.

**Actual current basis for NO-GO:**
- No real payment collection path exists (§27.7 — Billing).
- No production infrastructure has been provisioned or shown to be deployed (§27.7 — Production/infrastructure).
- No monitoring or error-tracking exists — a production incident would surface via a customer complaint, not observability (§27.7).
- Baseline account-lifecycle gaps remain (no password reset, no 2FA) (§27.7 — Auth).
- Other gaps listed in §27.7 (storage, queue retry policy, rate limiting on public writes) further support a cautious posture, though individually lower severity than the four points above.

Resolving the D4 security findings materially reduces the risk of running even a limited pilot, and strengthens the case for the "conditional GO for a small, trusted, non-paying pilot" scenario the original audit already described in §25 — but it does not change the answer for a real commercial production launch, which still requires the infrastructure, billing, and observability work listed above.

### 27.9 Historical vs. current state

Sections 1–26 of this document are preserved deliberately, in their original form, as the historical Phase 13.0 audit — the specific findings it identified (including the three security items resolved in D4) are what directly motivated and scoped the D4-A through D4-F work. They are not deleted or rewritten here so that this traceability remains intact for anyone reviewing why those changes were made.

**This section (§27) is the source of truth for the state of the repository as of `HEAD = 0f6a258a22b015b849dc42d3e215d4ce066a8f0f`.** Where §1–§26 and §27 disagree, §27 is correct. **It is not the source of truth for the current repository** — four further commits (Lots Q/R/S/T) have landed since; see [§28 — Post-Q/R/S/T Reconciliation](#28-post-qrst-reconciliation) for the current state as of `HEAD = 0d1f289bc5337c26dfb636ae8eefb5aa8ae803dd` (which also covers the Payment/Refund reconciliation scheduler, predating §27 but never covered by it).

---

No code changes were made as part of this documentation audit/reconciliation. `apps/api/src/main.ts` and `apps/api/src/workflow/events.processor.ts` are separately modified in the working tree as part of the unrelated Lot F Final code change, pending its own review.

---

## 28. Post-Q/R/S/T Reconciliation

### 28.1 Scope and date of reconciliation

- **Repository:** `korva-os` monorepo.
- **Branch:** `main`.
- **HEAD at time of this reconciliation:** `0d1f289bc5337c26dfb636ae8eefb5aa8ae803dd`.
- **Parent:** `d378963fc423f1726c9bd7fcec8992d0ecf4d469`.
- **`origin/main`:** `3053218d6885731220897852375be1c5dc2045d0` — local `main` is 18 commits ahead; none of the commits described in this section (or in §27) have been pushed.
- **Nature:** a further reconciliation layered on top of §27, not a fresh independent audit. §27 remains the accurate historical record for the D4 period ending at `HEAD=0f6a258`; this section extends that record forward through the commits that landed since, and separately notes one commit §27 omitted despite it predating §27's own HEAD.
- **Objective:** same as §27's — give a reader an accurate, self-contained picture of current status without reconstructing git history themselves.

### 28.2 The commits this section covers

Four commits landed **after** §27's `HEAD=0f6a258`, plus one that **predates** it but was never mentioned by §27. Each is a separate, self-contained commit with a disjoint file footprint — they must not be read as one undifferentiated "hardening batch."

| Commit | Name | Relative to §27's HEAD (`0f6a258`) | Files (top-level) |
|---|---|---|---|
| `fee9608` | Payment/Refund reconciliation scheduler | **Predates** `0f6a258` — omitted by §27, not "new since" | `.env.example`, `finance/finance.module.ts`, `finance/payments/reconciliation-scheduler.service.ts`, `test/payment-reconciliation-scheduler.e2e-spec.ts` |
| `7796559` | Lot Q — reliable event retries + action idempotency | After | `core/events/event-bus.service.ts`(+spec), `core/events/event-names.ts`, `workflow/events.processor.ts`, `workflow/schemas/workflow-action-claim.schema.ts`, `workflow/workflow-actions.service.ts`(+spec), `workflow/workflow-engine.service.ts`(+spec), `workflow/workflow.module.ts`, `workflow/workflows.repository.ts`, `test/workflow.e2e-spec.ts`, `packages/types/src/workflow.ts` |
| `5fedead` | Lot R — BullMQ queue metrics | After | `health/health.controller.ts`(+spec), `health/health.module.ts`, `health/queue-metrics.service.ts`(+spec), `test/health.e2e-spec.ts` |
| `d378963` | Lot S — definitive queue failure alerting | After | `health/health.module.ts`, `health/queue-alerting.service.ts`(+spec) |
| `0d1f289` | Lot T — password reset flow | After | `identity/auth/*`, `identity/users/*`, `communication/communication.module.ts`, `shared/email/*` — see §28.4 |

These commits touch four disjoint areas of the codebase (finance/scheduler, core/events+workflow, health, identity/communication/email) with no file overlap between any two of them — confirmed by direct inspection of each commit's file list.

### 28.3 Scheduler BullMQ, Lot Q, Lot R, Lot S — factual summary

**Scheduler BullMQ (`fee9608`).** A second, independent BullMQ queue (`payment-reconciliation`, distinct from the `events` queue Lot Q hardens) with a repeatable job on a configurable interval (default 5 minutes), sweeping Payments/Refunds stuck in `processing` and re-querying the payment provider to resolve them. Runs entirely inside `apps/api`, same in-process pattern as `EventsProcessor`.

**Lot Q (`7796559`).** Hardens the `events` queue specifically: `EventBusService.publish()` now passes explicit `JobsOptions` (`attempts: 5`, exponential backoff starting at 2s) instead of BullMQ's default `attempts: 1`. Adds a `WorkflowActionClaim` collection (claim-before-execute pattern, unique index on `(organizationId, workflowId, actionIndex, eventKey)`) so a BullMQ-level retry of an event cannot re-run a workflow action's side effect twice. **The `payment-reconciliation` queue (Scheduler BullMQ, above) received none of this at the time** — it ran with BullMQ's default `attempts: 1` and no explicit retry/backoff configuration, a real, confirmed asymmetry between the two queues that persisted until Lot V. **Lot V (`9874dc84bcb26aedd3c41bcb941375b13c6bfe74`)** subsequently closed this gap: `ReconciliationSchedulerService` now passes an `opts` field (`attempts: 3`, the same exponential backoff starting at 2s, an explicit `removeOnComplete: { age: 24 * 3600, count: 1000 }`, an explicit `removeOnFail: false`) in the job template passed to `upsertJobScheduler`. The two queues are deliberately **not** configured identically: `payment-reconciliation` uses `attempts: 3` rather than Lot Q's `5`, because each sweep re-derives its worklist from Mongo's current state rather than acting on job data — a BullMQ retry is just another full sweep, and the next scheduled tick (~5 min by default) is already a natural additional retry, so fewer BullMQ-level attempts are needed than for a per-entity `events` job.

**Lot R (`5fedead`).** Adds `GET /health/queues`, exposing aggregate BullMQ job counts (`waiting`/`active`/`completed`/`failed`/`delayed`/`paused`) for both the `events` and `payment-reconciliation` queues, read via a short-lived, separate Redis connection (never touching the producer/consumer connections). **This is targeted queue observability, not a general-purpose metrics system** — there is still no `/metrics` (Prometheus-style) endpoint and no generic APM; §19's "Metrics (Prometheus): NOT_IMPLEMENTED" finding remains accurate for anything outside these two specific queues.

**Lot S (`d378963`).** Adds `QueueAlertingService`, which subscribes to BullMQ's `QueueEvents` `'failed'` stream on both the `events` and `payment-reconciliation` queues and logs a fixed, non-identifying warning line (`QUEUE_JOB_FAILED — queue "<name>" has a definitively failed job`) with a 5-minute per-process cooldown, when a job exhausts all its retry attempts. **This is a log-line alert, not an integration with any alerting/paging system** (PagerDuty, Slack, email) **and not Sentry/error-tracking** — §19's "Error tracking (Sentry or equivalent): NOT_IMPLEMENTED" and "Alerting: NOT_IMPLEMENTED" findings remain accurate; Lot S narrows only the specific "a BullMQ job silently failed with zero signal" gap, nothing broader.

### 28.4 Lot T (`0d1f289bc5337c26dfb636ae8eefb5aa8ae803dd`) — password reset flow

Verified directly against the code at this HEAD:

- `POST /auth/forgot-password` and `POST /auth/reset-password` (`identity/auth/auth.controller.ts`), both `@Public()` and under the same `AUTH_THROTTLE` (30/min) already applied to `/auth/login`/`/auth/register`.
- Request bodies validated via `ZodValidationPipe` against `forgotPasswordSchema`/`resetPasswordSchema` (`packages/validation/src/auth.ts`); the reset-password field reuses `registerSchema.shape.password` — no separate password policy.
- Token: `randomBytes(32).toString('hex')`, SHA-256-hashed (`identity/auth/token-hash.util.ts`, the same primitive already used for refresh tokens) before it ever reaches MongoDB — the plaintext token is never persisted.
- Storage: one `PasswordResetToken` document per user (unique index on `userId`), `tokenHash` (`select:false`), `expiresAt`, `usedAt`. A new `forgot-password` request replaces (upserts over) any existing row for that user, invalidating a previously-issued, still-unused token.
- Expiration: 30 minutes (hardcoded — no new environment variable introduced).
- Consumption: a single atomic `findOneAndUpdate` filtering on `{tokenHash, usedAt: null, expiresAt: {$gt: now}}` and setting `usedAt` — the same accept/reject-by-filter pattern already used by `SessionsRepository.revokeActiveByTokenHash`. Enforces single use.
- Ordering in `PasswordResetService.resetPassword()`: the new Argon2 password hash is computed **before** the token is consumed; the token is consumed **before** the User document is touched; sessions are revoked (`SessionsService.revokeAllForUser`, unmodified) only after the password write succeeds. An invalid/expired/already-used token can therefore never result in a password change.
- Anti-enumeration: `forgot-password` returns an identical response (same status, same body) regardless of whether the email belongs to an account — verified by a dedicated e2e test comparing both responses byte-for-byte.
- The token is never returned in any API response and never appears in a logged value — verified by a dedicated unit test asserting on every `Logger` call made during both the success and the email-delivery-failure path.

**Limits, stated proportionately — none of the following is a critical vulnerability:**
- **Timing side-channel, not mitigated.** The "account exists" branch of `forgot-password` does more work (token issue + email) than the "no account" branch — a theoretically measurable timing difference. No dummy-cost work was added to equalize it.
- **No frontend page, at the time of this commit.** At `HEAD=0d1f289`, `apps/web` did not contain a `/reset-password` (or `/forgot-password`) route — confirmed by direct inspection of `apps/web/src/app` at that HEAD (only `dashboard`, `login`, `onboarding`, `register` existed). The backend flow was complete and independently tested via the API; the missing page was a separate, frontend-only piece of work. **This gap has since been closed by Lot U (`4876996`) — see §28.9.**
- **No rate limit specific to a single email address** — only the existing per-IP `AUTH_THROTTLE` applies, the same limitation already present on `/auth/login`/`/auth/register`.
- **A narrow, non-transactional residual window** between token consumption and the password-hash write: if the MongoDB write in `updatePasswordHash()` fails immediately after `consume()` already succeeded, the token is spent but the password is unchanged. Self-healing (the user can request a new token); deliberately not closed with a multi-document transaction — the token-consumption step alone is what gates correctness here.

### 28.5 Tests, as actually run at this HEAD

Distinct from — and superseding, for anything past `HEAD=0f6a258` — the counts in §27.6, which remain an accurate historical snapshot of that earlier HEAD and are left unaltered:

| Metric | §27.6 (`HEAD=0f6a258`) | This reconciliation (`HEAD=0d1f289`) |
|---|---|---|
| `*.e2e-spec.ts` files | 15 | **17** |
| `it`/`test` blocks in e2e sources (static count) | 159 | **170** |
| `*.spec.ts` files | 11 | **17** |
| Unit tests executed | 107/107 | **156/156** |
| E2E tests executed | not stated in §27.6 | **170/170** |
| `password-reset.e2e-spec.ts` in isolation | N/A (didn't exist) | **5/5, repeated 3 consecutive times, deterministic** |

### 28.6 Corrections to specific claims in §1–§27

The following individual statements, as written in §1–§27, are no longer accurate descriptions of the codebase at `HEAD=0d1f289` and must not be read as current. As with §27.5, the original text above is left unedited for historical traceability — this list is the correction layer.

- §1 line 19, §6 (Authentication Security Audit table, "Password reset"), §13, §24 P0 (`Implement password-reset flow`), §26 recommendation 7, §27.7 (Auth), §27.8 — **"no password-reset flow" / "NOT_IMPLEMENTED"**: resolved by Lot T (`0d1f289`), see §28.4.
- §27.7 (Queue) — **"`EventBusService.publish()` still calls `queue.add(name, data)` with no `JobsOptions`... `attempts: 1`"**: resolved for the `events` queue by Lot Q (`7796559`). **Also resolved for the `payment-reconciliation` queue** (Scheduler BullMQ, `fee9608`) by Lot V (`9874dc84bcb26aedd3c41bcb941375b13c6bfe74`) — that queue now passes an explicit `opts` (`attempts: 3`, exponential backoff, explicit `removeOnComplete`/`removeOnFail`) to `upsertJobScheduler`. See §28.3.
- §19 (Monitoring & Observability), "Queue monitoring (Bull Board or similar): NOT_IMPLEMENTED" — **narrowed, not resolved**: `GET /health/queues` (Lot R) and the `QUEUE_JOB_FAILED` log alert (Lot S) now provide targeted visibility into the two existing BullMQ queues specifically. A Bull Board dashboard, a generic `/metrics` endpoint, and Sentry/error-tracking integration remain entirely absent — see §28.3.
- §4 (line 95), §12, §24 (checklist item), §26 recommendation 8 — **"TTL index on `Session.expiresAt`: NOT_IMPLEMENTED... expired sessions accumulate in Mongo forever, no auto-purge"**: resolved by G6 (commit `7c581421003b78412c95ecdc9f471eae5939959e` — "feat(auth): add TTL index to sessions"), landed after this section's own `HEAD=0d1f289` — see §28.10.
- §4 (line 97), §19 (line 317), §24 (checklist item) — **"Request ID / correlation ID propagation: NOT_IMPLEMENTED — no middleware exists; makes cross-service request tracing impossible"**: the local HTTP request-id gap is resolved by commit `0faaf6a0e2324f9cba919ed6fa944aab33fb77a5` ("feat(core): add request ID middleware") — see §28.11. **The "cross-service request tracing" framing itself was never accurate for this codebase's real architecture** (a single monolith; `apps/worker` retired, see §21.0/ADR-005): this lot provides a **local, per-request** id only, not distributed tracing.
- §1 line 19, §4 (line 90), §6 (Authentication Security Audit table, "Email verification"), §24 (checklist item), §26 recommendation 7, §27.7 (line 606) — **"no email-verification flow" / "`emailVerifiedAt` field exists but is never set by any code path"**: resolved by commit `e05eea8953c97c89fc0e3c4f99e829dcefb4de01` ("feat(auth): add email verification flow"), landed after this section's own `HEAD=0d1f289` — see §28.12. **Verification remains informative-only** — it does not gate `login` or any other route; see §28.12 for the explicit product-decision boundary.

Every other individual finding in §1–§27 (billing, infrastructure provisioning, 2FA, file storage, generic metrics endpoint, Sentry, structured logging) is **unaffected by these commits** and remains exactly as characterized in §27.7/§27.8.

### 28.7 GO / NO-GO — unaffected

The §27.8 verdict (**NO-GO** for a real commercial launch) is unchanged by this reconciliation. Resolving the password-reset gap removes one item from the "baseline account-lifecycle gaps" basis cited in §27.8 (2FA alone remains open there), but the four substantive bases for NO-GO — no real payment collection path, no production infrastructure, no monitoring/error-tracking (Sentry), and the remaining account-lifecycle/storage/queue gaps — are all untouched by the commits covered in this section and remain fully valid.

### 28.8 Source of truth

**This section (§28) is the source of truth for the current state of the repository as of `HEAD = 0d1f289bc5337c26dfb636ae8eefb5aa8ae803dd`.** §27 remains the accurate historical record for the D4 period ending at `HEAD = 0f6a258`; where §27 and §28 disagree on anything covered by §28.6, §28 is correct. Neither section supersedes the other in general — §27 documents D4, §28 documents what has landed since (plus the one pre-existing omission noted in §28.2) — and no future reader should treat this document as current beyond `0d1f289` without checking `git log` for what has landed since this HEAD.

### 28.9 Lot U (`4876996`) — password reset frontend

Closes the frontend gap left explicitly open by Lot T (§28.4) — no backend change; `PasswordResetService`/`auth.controller.ts` (Lot T) remain the only business logic.

- **Scope:** `apps/web/src/app/forgot-password/page.tsx` (new, 95 lines) and `apps/web/src/app/reset-password/page.tsx` (new, 150 lines), each with a dedicated test (`page.test.tsx`, 103 and 142 lines); `apps/web/src/app/login/page.tsx` (link to `/forgot-password` added); new `vitest` test infrastructure for `apps/web` (`vitest.config.mts`, `vitest.setup.ts`, `apps/web/src/test/render.tsx` — `apps/web` had no tests at all before this commit); `apps/web/package.json`/`pnpm-lock.yaml` updated for the new test dependencies.
- **Result:** both routes exist and are functional, consuming the `POST /auth/forgot-password`/`POST /auth/reset-password` endpoints already shipped by Lot T.
- **Validations:** `pnpm --filter @korva/web test` → **17/17 Vitest tests passing** (3 files); `pnpm --filter @korva/web typecheck` → clean; `pnpm --filter @korva/web lint` → clean (script has no `--fix`). No regression on the `@korva/api` suite (unaffected — disjoint files).
- **Not addressed by this commit:** the timing side-channel, per-email rate limiting, and non-transactional residual window noted in §28.4 remain exactly as documented there — this is a frontend-only commit.

### 28.10 G6 (`7c581421003b78412c95ecdc9f471eae5939959e`) — TTL index on `Session.expiresAt`

Closes the "expired sessions accumulate in Mongo forever, no auto-purge" gap flagged in §4/§12/§24/§26 — no change to session creation, rotation, revocation, or reuse-detection logic; `auth.service.ts`/`sessions.service.ts`/`sessions.repository.ts` are all untouched by this commit.

- **Scope:** `identity/schemas/session.schema.ts` — `expiresAt`'s `@Prop` gains `expires: 0` (Mongoose's native TTL SchemaType option). Mongoose translates this into a real MongoDB index (`{ expiresAt: 1 }`, `expireAfterSeconds: 0`) via the app's existing `autoIndex` behavior (never overridden anywhere in `MongooseModule.forRootAsync`) — no separate bootstrap script or migration was needed or added. `expires: 0` deletes a document once the *absolute* date already stored in the field is reached, matching `expiresAt`'s existing semantics exactly (it already stores an absolute expiry timestamp, never a relative duration).
- **Validation:** `test/session-ttl-index.e2e-spec.ts` (new) — boots the real app against real MongoDB, runs the same `dropDatabase()`/`syncIndexes()` bootstrap already used elsewhere in this suite (e.g. `payment-reconciliation-scheduler.e2e-spec.ts`), then reads the collection's actual index list (`connection.collection('sessions').indexes()`, the same direct-collection pattern already used in `auth.e2e-spec.ts`/`password-reset.e2e-spec.ts`) and asserts `{ expiresAt: 1 }` exists with `expireAfterSeconds: 0` — proves the real Mongo index, not just the schema decorator. `auth.e2e-spec.ts` (5/5) and `password-reset.e2e-spec.ts` (5/5) re-run clean alongside it; full unit suite 157/157 unaffected.
- **Nuance, deliberately left as-is, not a bug:** MongoDB's TTL background monitor runs on its own cadence (roughly every 60s), not instantly at the exact expiry moment. `detectRefreshTokenReuse()` (`auth.service.ts`) looks up a session by hash with no filter on expiry/revocation, specifically to catch a *revoked-but-still-known* token being replayed (a compromise signal). If the TTL monitor has already physically deleted an expired-and-revoked session before a very late replay of that same token occurs, the lookup returns nothing instead of finding "known but revoked," so the defensive `revokeAllForUser()` side-effect won't fire for that specific case. This does **not** weaken the actual rejection of the replayed token — it was already rejected by the existing `expiresAt: {$gt: now}` filter in `revokeActiveByTokenHash` regardless of TTL; only the secondary compromise-signal side-effect becomes moot once both the token's own expiry and the TTL sweep have passed. Accepted and documented during the G6 pre-implementation audit; `detectRefreshTokenReuse()` itself was not modified by this commit.

### 28.11 Request ID middleware (`0faaf6a0e2324f9cba919ed6fa944aab33fb77a5`)

Closes the local part of the gap flagged in §4/§19/§24 — a plain Express middleware (`apps/api/src/common/middleware/request-id.middleware.ts`), registered via `app.use()` in `main.ts` alongside `helmet()`/`compression()`; deliberately not a `NestMiddleware` class.

- **Scope:** reads an incoming `X-Request-ID` header; reuses it only if it matches a strict UUID pattern, otherwise generates a fresh id via `crypto.randomUUID()` (`node:crypto`, no new dependency) — an arbitrary/malformed client value is never trusted or logged as-is, and never used as the id. The resolved id is attached to `req.id` (a local `RequestWithId` type, not a global `Express.Request` augmentation) and always echoed back on the response as `X-Request-ID`.
- **Validation:** `test/request-id.e2e-spec.ts` (new) — 3 real-HTTP scenarios against `GET /health` (boots the real app; `app.use(requestIdMiddleware)` is registered explicitly in the test itself, the same way every e2e file already repeats `setGlobalPrefix('api/v1')`, since building a `TestingModule` directly from `AppModule` never runs `main.ts`'s own `bootstrap()`): no header → a valid UUID is generated; well-formed header → echoed back unchanged; malformed header → ignored, a fresh UUID is generated instead. `auth.e2e-spec.ts` (5/5) and the full unit suite (157/157) re-run clean alongside it.
- **Explicitly not provided by this commit — do not read this as more than it is:** no distributed/cross-service tracing, no `traceparent`/W3C Trace Context support, no Sentry or any error-tracking integration, no automatic correlation in the existing `Logger` calls (the id lives on `req`/`res` only — nothing threads it into `Logger.log/warn/error` today), no `AsyncLocalStorage`/CLS request context, no propagation of the id to outbound calls (Anthropic, Resend, user-configured webhooks) or into BullMQ job data. This is a **local, per-HTTP-request identifier** only — the "cross-service request tracing" framing in §4/§19 predates the (already-completed) removal of `apps/worker` and never described a real multi-service architecture that exists in this codebase (see §21.0/ADR-005: `apps/api` is the only running service).

### 28.12 Email verification flow (`e05eea8953c97c89fc0e3c4f99e829dcefb4de01`)

Closes the "`emailVerifiedAt` field exists but is never set by any code path" gap flagged in §1/§4/§6/§24/§26/§27.7 — no change to `login()`, `JwtStrategy`, sessions, RBAC, or `password-reset.*`; the two flows share only the `hashToken()` utility and the same storage *pattern*, never the same collection.

- **Scope:** `EmailVerificationToken` (new, dedicated `email_verification_tokens` collection — deliberately separate from `PasswordResetToken`'s collection so a bug in one operation can never silently affect the other) — `userId` (unique index, one active token per user, a new request invalidates any previous unused one), `tokenHash` (`select:false`), `expiresAt`, `usedAt`. Token generated via `randomBytes(32)` (256 bits), hashed with the existing `hashToken()` utility (SHA-256) — the raw token is never persisted, logged, or returned by any API response. Expiration is applicative (30 minutes, computed at issuance, exactly the `PasswordResetToken` pattern — no Mongo-native TTL). Consumption is a single atomic `findOneAndUpdate` (`tokenHash` + `usedAt: null` + `expiresAt: {$gt: now}` → `usedAt` set), guaranteeing single use with no separate validate-then-update sequence. `AuthService.register()` issues the token and sends the email additively, in a `try/catch` that logs and never propagates — a failure here can never turn a successful account creation into a failed request. Verification is `POST /auth/verify-email`, `@Public()`, `@Throttle(AUTH_THROTTLE)`, body `{ token }` only (no `userId` accepted from the client — it is derived exclusively from the consumed token document server-side), reusing the existing `EMAIL_PROVIDER` abstraction (no new provider, no new dependency) and `interpolate(..., {escapeHtml: true})` for the email body. An invalid, expired, or already-used token all produce the identical `401 INVALID_VERIFICATION_TOKEN` — never distinguished.
- **Validation:** `test/email-verification.e2e-spec.ts` (new, 7 scenarios) — 7/7. `auth.e2e-spec.ts` 5/5, `password-reset.e2e-spec.ts` 5/5, full unit suite 157/157 (18 suites) all re-run clean alongside it. Typecheck 0 errors, build succeeded.
- **Verification is deliberately NOT mandatory in this lot — do not read this as more than it is:** a user with `emailVerifiedAt === null` can register, log in, and use every existing route exactly as before — `login()` and `JwtStrategy.validate()` were not modified, and no guard reads `emailVerifiedAt`. No route is gated on verification status. Whether verification should ever become mandatory (which routes, what grace period, what messaging) is an explicit, separate product decision, not made by this commit. `test/email-verification.e2e-spec.ts`'s TEST 7 exists specifically to pin this behavior down and catch any future accidental regression toward blocking. No `resend-verification` endpoint, no frontend page, and no new environment variable were added — `APP_URL` (already used by `password-reset.service.ts`) is reused as-is for the verification link.

---

## 29. Post-V2 Reconciliation (2026-10-12)

### 29.1 Why this section exists, and a warning about §28

- **Repository:** `korva-os` monorepo, branch `main`.
- **HEAD at time of this reconciliation:** `e0c971fff715d434158bcda20b9bea97098c781a`.
- **Nature:** a reconciliation layered on §27 and §28, not a fresh independent audit. Method: direct source inspection at this HEAD, never trusting a prior section's claim about what is or is not implemented.

**§28 declares itself "the source of truth for the current state of the repository as of `HEAD = 0d1f289`." 197 commits have landed since.** Anyone who read §28 as current status between then and now was misled on at least nine items it lists as open, every one of which has shipped. §28's own closing sentence anticipated exactly this ("no future reader should treat this document as current beyond `0d1f289` without checking `git log`") — that instruction was correct and was not followed. Treat this section the same way: check `git log` against the HEAD above before trusting it.

The structural lesson, recorded because it has now repeated three times (§27, §28, §29): a reconciliation section dated against a HEAD goes stale the moment the next commit lands, and each successive layer makes the document harder to read correctly rather than easier. A reader can no longer answer "is file storage implemented?" without reading four sections in order and applying three correction layers. **Recommendation: the next person to touch this document should replace §1–§29 with a single re-derived status table rather than appending §30.** Preserving the original audit text for traceability is worth something, but it has stopped being worth the cost of misleading every reader who stops before the last section.

### 29.2 Findings from §1–§28 that are no longer accurate

Each verified by direct inspection at this HEAD, not inferred from a commit message.

| Finding, as stated in §1–§28 | Actual state | Evidence |
|---|---|---|
| Error tracking (Sentry or equivalent): NOT_IMPLEMENTED (§19, §24, §26 rec. 5) | **Implemented** | `core/observability/sentry.ts`, initialized in `main.ts`, wired into `common/filters/http-exception.filter.ts` |
| Structured logging with shipping to an aggregator: NOT_IMPLEMENTED (§19, §24) | **Implemented** | `common/logging/structured-logger.service.ts` replaces Nest's `ConsoleLogger` via `app.useLogger()`; JSON output, stamped with the request id from `common/middleware/request-id.middleware.ts` |
| 2FA: NOT_IMPLEMENTED (§6, §24, §26 rec. 7) | **Implemented** | `identity/auth/two-factor.service.ts`, `two-factor.controller.ts`, fields on `identity/schemas/user.schema.ts` |
| API Keys (model, guard, audit-trail): NOT_IMPLEMENTED (§9, §24) | **Implemented** | `identity/schemas/api-key.schema.ts`, `core/guards/api-key.guard.ts`, `identity/api-keys/*`, incl. a role-hierarchy check on creation |
| File/object storage for uploads: NOT_IMPLEMENTED (§14, §24, §26 rec. 9) | **Implemented** | `shared/storage/` — S3 backend + local-disk engine, `uploads.controller.ts`, `file-signature-checks.ts` |
| Wrap Payment→Invoice and Order→Cart writes in transactions (§12, §24) | **Implemented** | `withTransaction` / `startSession` in `commerce/orders/orders.service.ts`, `finance/payments/payments.service.ts`, `booking/bookings/bookings.service.ts`, `crm/contacts/contacts.service.ts` |
| No real payment provider; `ManualPaymentProvider` is the only adapter (§1, §10, §16, §25 basis 1) | **Implemented for Flow B** | `finance/payments/providers/` — Paystack and Flutterwave adapters, webhook signature verifiers, webhook controllers, `payment-provider.registry.ts`, `payment-provider-resolver.service.ts` |
| Build an audit-log read API (§24 P2) | **Implemented** | `audit/audit.controller.ts` |
| Build a custom/editable roles API (§24 P2) | **Implemented** | `identity/roles/roles.controller.ts` |
| Split CORS policy between public and authenticated routes (§24 P2) | **Implemented** | `publicCorsMiddleware` runs before `app.enableCors()` in `main.ts`; permissive `/public/*` policy, strict allowlist for the dashboard |
| Add account-level brute-force protection beyond IP rate limiting (§24 P1) | **Implemented** | `failedLoginAttempts` / `lockedUntil` on `user.schema.ts`, enforced against `MAX_FAILED_ATTEMPTS` in `identity/auth/auth.service.ts` |
| Add rate limiting to public storefront write endpoints (§24 P1) | **Implemented** | `@Throttle(PUBLIC_BOOKING_THROTTLE)` on the write routes in `public/public.controller.ts` |
| Fix booking engine to use `Organization.timezone` instead of raw UTC (§24 P2) | **Implemented** | commit `5ff82e8`, ADR-004 |
| Metrics endpoint: NOT_IMPLEMENTED (§19, §24 P1) | **Implemented** | `health/metrics.controller.ts` — `GET /metrics`, Prometheus 0.0.4 exposition format |
| Add audit logging to login/logout events (§24 P2) | **Implemented, as structured log events rather than audit rows** | `identity/auth/auth.service.ts` emits AUTH_LOGIN_SUCCEEDED / AUTH_LOGIN_FAILED / AUTH_LOGIN_BLOCKED / AUTH_ACCOUNT_LOCKED / AUTH_LOGOUT. Not AuditService: `AuditLog.organizationId` is required and `listRecent` filters on it, but a login has no organization — see that method's own doc comment |
| Mid-period proration computed but never billed | **Implemented** | Folded into the next `SubscriptionInvoice` amount and then cleared, so it bills once; a credit beyond the period price is clamped at zero — `SubscriptionPeriodSchedulerService.resolveRenewal` + `SubscriptionsRepository.clearAppliedProration` |
| Onboarding verticals: 17/17 omitted `website` while all 17 name a `defaultStorefrontTemplate` | **Fixed** | `packages/types/src/verticals.ts`, enforced by `vertical-templates.spec.ts` (8 coherence rules) |
| Add dependency vulnerability scanning to CI (§24 P2) | **Implemented, in three layers** | `.github/dependabot.yml` (weekly grouped update PRs) and `.github/workflows/codeql.yml` (JS/TS SAST, weekly) already existed — §24 was stale on this before any work in this round. Neither *gates* a build on a known advisory, so a `dependency-audit` job running `pnpm audit --audit-level high` was added to `ci.yml` |
| KORVA's own subscription billing has no PSP path; `past_due` is unreachable (§10, and `subscription.schema.ts`'s own comment) | **Implemented (invoice-first)** | `subscriptions/schemas/subscription-invoice.schema.ts`, the billing branch of `subscription-period-scheduler.service.ts`, and `subscription-billing/` for checkout + verification. See §29.4 for the one capability this deliberately does NOT provide |

### 29.3 What is still genuinely open

Short, and deliberately so — this is the real remaining list, not a restatement of §24.

1. **Production infrastructure is still not provisioned.** No managed MongoDB/Redis, no hosting for the three apps, no DNS/TLS, placeholder secrets unrotated, no real `RESEND_API_KEY`, no SPF/DKIM/DMARC. This is the single largest remaining item and none of it is a code change — it needs accounts, credentials and billing. See `docs/deployment.md` for the step-by-step runbook.
2. **No migration tool and no first migration.** Schema changes still rely on Mongoose `autoIndex` and ad-hoc scripts. Unchanged since §24 flagged it.
3. **AI token-level usage is not persisted**, so per-tenant AI cost cannot be attributed. Unchanged since §24.
4. **No credit-balance concept.** A proration credit larger than the period it offsets is clamped at zero, with the unapplied remainder recorded in the audit trail rather than carried forward to the following invoice. Acceptable while plan prices sit close together; revisit if a downgrade can generate a credit worth more than one month.
5. **No Bull Board.** Largely superseded rather than open: `GET /health/queues`, `GET /metrics` and `QueueAlertingService` now cover all 12 queues (see `core/queues/queue-registry.ts`). What remains missing is only a browsable UI for inspecting and retrying individual jobs.
6. **Four moderate advisories and one unfixable high.** `pnpm audit` reports 5 findings, 0 critical. The high (`braces`, stack-exhaustion DoS) names `patched_versions ">=3.0.4"`, which has never been published; it reaches the tree only through `eslint-config-next` dev tooling and is the single entry in `auditConfig.ignoreGhsas`.

### 29.4 One capability deliberately not built, so nobody assumes it exists

**KORVA cannot charge a card on file.** Subscription renewal issues a `SubscriptionInvoice` and the tenant pays it through a hosted checkout link; there is no server-initiated recurring charge.

This is a constraint of the adapters, not an oversight. `PaystackProvider.createPayment` calls `/transaction/initialize` and `FlutterwaveProvider` returns `data.link` — both are hosted-checkout flows whose status stays `'pending'` until a human completes a redirect, and nothing in the codebase stores a reusable card authorization or mandate. Wiring `createPayment` into the background sweep would mint checkout URLs nobody opens and strand every paid subscription in `past_due`, which is strictly worse than the free-renewal behavior it would replace.

Adding true card-on-file billing means: an optional `chargeRecurring()` on the `PaymentProvider` interface, adapters for Paystack `charge_authorization` and Flutterwave tokenized charges, an encrypted per-organization mandate captured at first successful payment, and the webhook routing to reconcile it. That is a project phase, not an increment.

### 29.5 GO / NO-GO

**Still NO-GO for a public production launch, but the reason has changed, and that distinction matters.**

Of the four bases §28.7 cited, three are now closed: there is a real payment path for both flows, error tracking and structured logging exist, and the account-lifecycle gaps (password reset, email verification, 2FA, brute-force lockout) are all shipped. **The remaining blocker is operational, not architectural: nothing is deployed.** No hosting, no managed data stores, no DNS/TLS, no rotated secrets.

That is a materially better position than §25 and §28.7 described. The codebase is no longer the limiting factor — provisioning is. A closed pilot on real infrastructure is now a reasonable next step, and the P0 security items that made the earlier conditional-GO conditional have all been fixed.
