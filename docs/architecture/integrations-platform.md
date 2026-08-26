# Integrations Platform Architecture — Wave 4 Foundation

## Status
Proposed — presented for owner validation. Nothing in this document is implemented yet. No Wave 4
implementation agent should be launched until this is explicitly approved (or amended and
re-approved).

## Why this document exists

The owner's Wave 4 decision gate (2026-08-26) resolved the product/business questions that were
blocking implementation (PSP market priority, merchant-of-record model, WhatsApp BSP sequencing).
It also gave one explicit instruction ahead of any agent launch: design and validate the shared
architecture — `IntegrationCredential` + provider adapters + webhook/idempotency/security model —
before Wave 4 proper begins. This document is that design. It is grounded directly in the current
codebase (read, not assumed): `payment-provider.interface.ts`, `messaging-provider.interface.ts`,
`two-factor.service.ts`'s existing AES-256-GCM pattern, `EventBusService`/BullMQ, the
`resend-webhook.*` pipeline, and the `Idempotency-Key` pattern in `payments.repository.ts`.

## 1. Owner decisions this design is built on

| # | Decision | Consequence for this design |
|---|---|---|
| 1 | KORVA is incorporated in **Morocco** | Unblocks Flow A (KORVA's own subscription billing) as a separate, narrower question from Flow B. Not researched yet — flagged as a small follow-up in §9, not re-litigated here. |
| 2 | KORVA is **Merchant of Record** for Flow B | KORVA holds the PSP relationship; tenants do **not** each connect their own provider account. What's tenant-scoped is a **payout destination**, not a PSP credential. This is the single biggest structural driver of §2 below. |
| 3 | **Côte d'Ivoire first**, Morocco second, no forced single PSP | The provider registry/resolver must support adding a second market's adapter with zero refactor — driving the registry pattern in §4, not a hardcoded branch. |
| 4 | WhatsApp starts as **BSP-managed** (360dialog first candidate), not Meta Tech Provider | `MESSAGING_PROVIDER` binding must stay provider-agnostic — 360dialog is a swappable adapter, never named in domain code. |
| 5 | Low/medium initial WhatsApp volume, must scale without re-architecture | No volume-driven shortcuts (e.g. no polling-only status, no unindexed lookups) — the webhook pipeline in §6 is sized for scale from day one even though early traffic is light. |
| 6 | **No CinetPay**; Flutterwave for CI as technical-spike candidate, pending real KYC/commercial validation | Flutterwave is the first Flow-B adapter built. Its adapter must be swappable without touching domain code, since "technical spike" explicitly means this pick is not yet final. |

## 2. Core primitive: `IntegrationAccount`

One collection, not two, with a `scope` discriminator — because Merchant-of-Record and per-tenant
WhatsApp WABAs are genuinely different shapes of the same underlying idea ("KORVA holds a secret
tied to an external provider, sometimes on its own behalf, sometimes on a tenant's").

```
IntegrationAccount
  scope           'platform' | 'tenant'
  organizationId  ObjectId | null   // required iff scope === 'tenant'; forbidden iff 'platform'
  domain          'payment' | 'messaging'
  provider        string            // 'flutterwave' | 'charibaas' | 'cmi' | '360dialog' | 'twilio' | 'manual' | 'log' | ...
  role            string            // disambiguates multiple platform accounts in the same domain:
                                     //   payment: 'subscription-billing' (Flow A) | 'merchant-of-record' (Flow B)
                                     //   messaging: 'bsp-partner'
  market          string | null     // 'CI' | 'MA' | null (global) — lets the resolver pick the right
                                     // platform account for a tenant's country
  status          'pending' | 'active' | 'disabled' | 'revoked' | 'error'
  secretEncrypted string            // AES-256-GCM, see §3 — absent entirely for records that hold
                                     // no bearer secret of their own (e.g. a tenant's WhatsApp WABA
                                     // whose calls are authenticated via the platform BSP-partner key)
  metadata        Record<string, unknown>   // NON-secret only: subaccountId, wabaId, phoneNumberId,
                                             // displayName, webhookConfigId, environment (sandbox/live),
                                             // payoutDestination (bank/mobile-money ref for split settlement)
  lastVerifiedAt  Date | null
  lastErrorAt     Date | null
  lastErrorMessage string | null
  createdAt / updatedAt
```

Indexes:
- `{ scope, domain, provider, market, role }` unique, partial on `scope: 'platform'`
- `{ organizationId, domain, provider }` unique, partial on `scope: 'tenant'`

Two concrete examples this shape has to support side by side:
- **Flow B, Côte d'Ivoire (Merchant-of-Record)**: one `platform`-scope row
  (`domain: 'payment', provider: 'flutterwave', role: 'merchant-of-record', market: 'CI'`) holding
  KORVA's own Flutterwave secret key. Each tenant gets a `tenant`-scope row in the same domain
  (`provider: 'flutterwave'`, **no `secretEncrypted`**, `metadata.subaccountId` = the tenant's
  Flutterwave sub-account for split settlement). The tenant never holds a bearer secret at all —
  consistent with decision #2.
- **WhatsApp, per tenant**: one `platform`-scope row (`domain: 'messaging', provider: '360dialog',
  role: 'bsp-partner'`) holding KORVA's 360dialog partner API key. Each tenant gets a `tenant`-scope
  row (`provider: '360dialog'`, `metadata.wabaId`, `metadata.phoneNumberId`, `metadata.displayName`)
  — and, only if 360dialog's embedded-signup model issues a **per-channel** token distinct from the
  partner key (to be confirmed at implementation time per decision #5), that token lives encrypted
  on this same tenant-scope row.

This directly answers §6 of the original mandate ("chaque intégration doit avoir organizationId,
provider, status, credentials reference, createdAt, updatedAt, metadata") while also representing
the platform-level rows the mandate explicitly permits ("sauf pour une configuration explicitement
platform-level").

## 3. Credential encryption

`two-factor.service.ts` already implements AES-256-GCM encrypt/decrypt for TOTP secrets, keyed by
`SHA-256(JWT_SECRET)`. That pattern is proven and stays untouched — this design does **not** modify
`two-factor.service.ts`. Instead, a new, small shared service replicates the same algorithm for
`IntegrationAccount.secretEncrypted`, with one deliberate improvement: **its own dedicated key**,
not a reuse of `JWT_SECRET`.

- New required env var: `INTEGRATION_CREDENTIALS_KEY` (added to `REQUIRED_VARS` in
  `env.validation.ts`, alongside `JWT_SECRET`/`JWT_REFRESH_SECRET`).
- Rationale for a dedicated key (the thing `two-factor.service.ts`'s own doc comment already flags
  as "marginally better hygiene" but didn't do, to stay in-lot): rotating `JWT_SECRET` (e.g. after
  an incident) would otherwise silently corrupt every stored PSP/WhatsApp credential platform-wide
  — a materially bigger blast radius than 2FA secrets, which only affect login. Worth the one extra
  env var.
- `CredentialEncryptionService.encrypt(plaintext: string): string` / `.decrypt(ciphertext: string): string`,
  same iv+authTag+ciphertext encoding `two-factor.service.ts` already uses, new file, zero changes
  to identity/auth code.
- **Never returned to the frontend**: no controller ever includes `secretEncrypted` (or a decrypted
  value) in a response DTO. Read endpoints return `status`, `provider`, `market`, `lastVerifiedAt`,
  and non-secret `metadata` only.
- **Absent from logs**: the structured logger's request-scoped context never receives raw secrets —
  enforced by never passing decrypted values to `Logger.log()`/`console`, verified in tests (see §9
  test list).
- **Rotatable / revocable**: rotating means inserting a new `IntegrationAccount` version and marking
  the old one `status: 'revoked'` (kept, not deleted, for audit trail) — mirrors how `ApiKey`
  rotation already works in this codebase.

## 4. Payment provider resolution (Flow A vs Flow B, CI vs MA)

The existing `PaymentProvider` interface (`createPayment`/`verifyPayment`/`getPaymentStatus`/
`refundPayment`) is correct and unchanged — every adapter still implements exactly this shape. What
changes is *how one gets selected*, replacing today's single `useClass: ManualPaymentProvider`
binding:

```
PaymentProviderResolver
  resolve(input: { flow: 'subscription' | 'commerce'; organizationId: string }): Promise<PaymentProvider>
```

- `flow: 'subscription'` (Flow A) → looks up the single `platform`-scope
  `IntegrationAccount(domain: 'payment', role: 'subscription-billing')` — market-independent, since
  Flow A's geography is KORVA's own incorporation, not the tenant's. Provider TBD (§9).
- `flow: 'commerce'` (Flow B) → reads the tenant's `Organization.country`, looks up the
  `platform`-scope `IntegrationAccount(domain: 'payment', role: 'merchant-of-record', market: <country>)`,
  and instantiates the matching adapter (`FlutterwaveProvider` for `CI` today; a `market` with no
  registered platform account throws a clear, typed error rather than silently falling back to
  `ManualPaymentProvider` — no fake completeness).
- Adding Morocco later means registering one more `IntegrationAccount` row and one more adapter
  class in the resolver's registry — zero changes to `PaymentsService`/`OrdersService`/any
  controller. This is the concrete mechanism behind decision #3's "no refactor" requirement.

**Split settlement** (a genuinely new domain concept, required by Merchant-of-Record): a
`SettlementService` computes KORVA's commission and the tenant's payable share per completed
payment, and either (a) calls the PSP's own split/subaccount primitive at payment-creation time
(Flutterwave's sub-account split, per the PSP decision record) so settlement is automatic, or (b)
accrues a per-tenant payable balance for periodic payout if the PSP's split feature can't be used
for a given payment shape. Which of (a)/(b) applies is an implementation-time detail per adapter,
not a domain-level branch — `SettlementService` calls the adapter, not the other way around.

## 5. Messaging / WhatsApp provider architecture

`MessagingProvider`'s current `send({ to, body }) → { providerReference, status }` shape is too
narrow for real WhatsApp semantics (template category, delivery status beyond sent/failed, opt-in).
Proposed extension, additive only — nothing existing breaks:

```
MessagingProvider
  readonly name: string
  sendTemplate(input: { to: string; templateName: string; params: Record<string,string>; category: 'marketing'|'utility'|'authentication' }): Promise<MessagingSendResult>
  sendSessionReply(input: { to: string; body: string }): Promise<MessagingSendResult>   // existing send(), renamed for clarity — inside a customer-initiated 24h window, no template required

MessagingSendResult
  providerReference: string
  status: 'sent' | 'delivered' | 'read' | 'failed'   // extended from today's 'sent' | 'failed'
```

- `MESSAGING_PROVIDER` binding moves to a `useFactory` in a new `MessagingProviderModule`, mirroring
  `EmailModule`'s existing factory exactly (`configService.get('MESSAGING_PROVIDER') === '360dialog'`
  → real adapter; otherwise `LogMessagingProvider`, unchanged default). `360dialog` is never imported
  or referenced by name outside this one factory and its adapter file — satisfies decision #4.
- Per-tenant WABA → `IntegrationAccount(scope: 'tenant', domain: 'messaging', provider: '360dialog')`
  as in §2. The resolver here is simpler than payments (no market branch): given `organizationId`,
  look up the tenant's own row; if none/`status !== 'active'`, the send fails closed with a typed
  `WHATSAPP_NOT_CONNECTED` error surfaced to the frontend (§10 in the original mandate — "Connect
  your payment provider" style prompt, not a silent no-op).
- **Opt-in gate**: per the WhatsApp decision record's own finding, `Contact` has zero consent
  modeling today. This design adds one field, generalized across channels (not WhatsApp-specific,
  since email already has similar "was this address ever bounced/unsubscribed" needs):
  `Contact.consents: { channel: 'whatsapp'|'email'|'sms'; grantedAt: Date; source: string; revokedAt?: Date }[]`.
  `sendTemplate` (business-initiated) checks this; `sendSessionReply` (customer-initiated) does not
  need to, matching Meta's own policy shape.

## 6. Generic webhook ingestion pipeline

Generalizes the already-working, already-tested `resend-webhook.*` pipeline into a shared module so
Flutterwave and 360dialog webhooks don't each reinvent it:

```
apps/api/src/integrations/webhooks/
  webhook-verifier.interface.ts     WebhookVerifier { verify(rawBody: Buffer, headers): boolean }
  flutterwave-webhook-verifier.ts   HMAC-SHA256 per Flutterwave's own scheme
  three-sixty-dialog-webhook-verifier.ts   X-Hub-Signature-256 (Meta passthrough, per the WhatsApp decision record's own findings)
  integration-webhook-event.schema.ts     { provider, providerEventId, domain, payload, receivedAt }
  integration-webhook.service.ts    persist + idempotency + publish
```

Pipeline, identical shape to Resend's proven one:

```
incoming webhook  (raw body via NestFactory's existing rawBody:true, @Public(), @Throttle)
  → WebhookVerifier.verify()            — 401/503 fail-closed if secret unconfigured, exactly like ResendWebhookController today
  → extract provider's own event id
  → idempotency check                    — unique index on (provider, providerEventId) in IntegrationWebhookEvent,
                                            same mechanism already proven twice (Resend email_id, payments Idempotency-Key)
  → persist raw event                    — audit/replay trail
  → EventBusService.publish(...)         — reuses existing BullMQ queue, retry/backoff, and E2E-INFRA-5 isolation
                                            infrastructure as-is; two new SystemEvent names:
                                            'payment.webhook_received', 'whatsapp.status_updated'
  → existing domain handlers consume     — payment status via the same atomic findOneAndUpdate CAS
                                            pattern PaymentsService already uses; message status via
                                            the same MessagesRepository.updateStatusByProviderReference
                                            regression-guard pattern already proven for Resend
  → structured log per §12 of the mandate: { integration, provider, organizationId, eventType, eventId, status, durationMs }
```

No new queue infrastructure is needed — this rides entirely on the `EventBusService`/BullMQ
plumbing that Wave 3 already made safely testable under concurrency (E2E-INFRA-5).

## 7. Security model summary

| Concern | Mechanism |
|---|---|
| Credential leakage | AES-256-GCM at rest, dedicated key (§3), never in response DTOs, never logged |
| Webhook forgery | Mandatory `WebhookVerifier` per provider, fail-closed if unconfigured — no provider ships without one |
| Replay | Idempotency via unique `(provider, providerEventId)` index, not a timestamp heuristic |
| Tenant isolation | Every `tenant`-scope query filtered by `organizationId`; `platform`-scope rows never reachable from any tenant-facing route |
| SSRF on outbound provider calls | Reuse the existing `safe-fetch.ts` guard (already audited in Wave 3) for any server-initiated call to a provider's status/verify endpoint |
| "HTTP 200 ≠ paid" | `PaymentsService` only transitions a payment to `completed` from a verified webhook event or an explicit `verifyPayment()` call — never from the initial `createPayment()` response alone, matching §7 of the mandate exactly |

## 8. Wave 4 lot sequencing (for when agents launch)

This is a **two-stage** launch, not one flat parallel wave — the owner's "architecture first"
instruction implies a real dependency order, not just a design courtesy:

**Stage 1 — foundation (must land and pass its own tests before Stage 2 starts):**
- `FOUND-CREDENTIALS`: `IntegrationAccount` schema + `CredentialEncryptionService` + `INTEGRATION_CREDENTIALS_KEY` env wiring
- `FOUND-WEBHOOK`: generic webhook pipeline (§6), built and tested against a fake provider, no real Flutterwave/360dialog code yet
- `FOUND-PAYMENT-RESOLVER`: `PaymentProviderResolver` + `SettlementService` skeleton, tested against a fake adapter
- `FOUND-MESSAGING-FACTORY`: `MessagingProviderModule` factory + extended `MessagingProvider` interface + `Contact.consents`

**Stage 2 — real adapters (parallel, each behind Stage 1's interfaces, file-disjoint):**
- `PAY-FLUTTERWAVE`: real adapter + its `WebhookVerifier`, against Flutterwave's sandbox
- `MSG-360DIALOG`: real adapter + its `WebhookVerifier`, against 360dialog's sandbox
- `FRONTEND-INTEGRATIONS`: Settings → Integrations UI, built only against Stage 1's read-only summary endpoints (never against raw `IntegrationAccount` documents)
- `OBSERVABILITY`: metrics (`payment_success`, `payment_failed`, `webhook_received`, `webhook_failed`, `whatsapp_sent`, `whatsapp_failed`) if the existing infra supports it without new dependencies

Each agent still gets its own git worktree, strictly disjoint file ownership, no `git stash`, per
the standing rule.

## 9. Explicitly NOT decided or built by this document

- **Flow A's actual PSP.** Owner decision #1 unblocks the *question* (Morocco-domiciled company
  billing tenants for KORVA's own SaaS) but nobody has researched *which* provider fits a
  Morocco-incorporated company billing internationally. This is a narrow, fast follow-up — not a
  redo of the Flow-B research — recommended before `FOUND-PAYMENT-RESOLVER`'s subscription-billing
  branch is exercised for real (the resolver and schema support it either way; only the concrete
  adapter is missing).
- **Morocco's Flow-B provider** (ChariBaaS vs. CMI) — second phase, per decision #3.
- **360dialog vs. Twilio final commercial terms** — explicitly deferred to implementation time per
  decision #5; the factory pattern in §5 makes this a config change, not a code change, either way.
- **Real merchant accounts, KYC, signed contracts, production webhook secrets.** Per the owner's
  explicit caveat, nothing here is production-ready until those are independently validated. Stage
  2 adapters are built and tested against each provider's **sandbox**, using realistic fake/test
  adapters in CI per §13 of the original mandate — never calling a real provider from automated
  tests.

## 10. Tests this design implies (not yet written)

Per provider adapter: success, failure, timeout, malformed response, invalid signature, duplicate
webhook, replay webhook, wrong tenant, wrong currency, wrong amount (unit) — connection, payment,
webhook, idempotency, failure, refund (e2e) — exactly the list in §13 of the original mandate,
scoped to whichever adapters Stage 2 actually builds (Flutterwave, 360dialog).

## 11. As-Built — Stage 1 (addendum, 2026-08-26)

**Status.** Stage 1 (§8's four `FOUND-*` lots) has landed and merged to `main` at commit
`adc4228` via four agent worktrees (`wave4/webhook-infra`, `wave4/provider-resolvers`,
`wave4/settlement-service`, plus the `IntegrationsModule`/`CredentialEncryptionService` lot) and
one orchestrator convergence commit. §1-§10 above are left exactly as owner-approved; this section
records what the code actually does, verified file-by-file against the merged result, not against
agent self-reports. All 15 Stage 1 spec files (114 tests) pass as of this commit.

Everything below is scoped to **Stage 1 only** — no Stage 2 adapter (Flutterwave, 360dialog) exists
in this codebase yet, so anything in §1-§10 that describes Stage 2 behavior is still purely
prospective and out of scope for this addendum.

### 11.1 Matches the design exactly

- **`IntegrationAccount` shape (§2).** Every field in the design's table exists with the same name
  and semantics: `scope`, `organizationId` (null iff platform), `domain`, `provider`, `role`,
  `market`, `status`, `secretEncrypted` (`select: false`, mirroring `ApiKey.keyHash`), `metadata`,
  `lastVerifiedAt`, `lastErrorAt`, `lastErrorMessage`. File:
  `apps/api/src/integrations/schemas/integration-account.schema.ts`.
- **Credential encryption (§3).** `CredentialEncryptionService`
  (`apps/api/src/shared/crypto/credential-encryption.service.ts`) is AES-256-GCM with the same
  `iv:authTag:ciphertext` hex encoding as `two-factor.service.ts`, keyed from its own
  `INTEGRATION_CREDENTIALS_KEY` (added to `REQUIRED_VARS` in
  `apps/api/src/core/config/env.validation.ts` and to `.env.example`), not `JWT_SECRET`. Never
  touches `two-factor.service.ts`. No controller in this Stage 1 lot returns `secretEncrypted` or a
  decrypted value — `IntegrationsService.getDecryptedPlatformSecret` is the only decrypt path and
  has a signature that cannot be reached from any tenant-facing method.
- **Rotation/revocation semantics (§3).** Both `IntegrationsService.rotateTenantAccountSecret` and
  `rotatePlatformAccountSecret` insert a new row (`status: 'active'`) and mark the old one
  `status: 'revoked'` — never delete, never mutate in place — exactly as designed.
- **`PaymentProvider` interface (§4).** `payment-provider.interface.ts`'s
  `createPayment`/`verifyPayment`/`getPaymentStatus`/`refundPayment` shape is byte-for-byte
  unchanged.
- **`PaymentProviderResolverService` (§4).** Resolves `flow: 'subscription'` to the
  market-independent `role: 'subscription-billing'` platform account, and `flow: 'commerce'` to
  `role: 'merchant-of-record'` keyed on the tenant's `Organization.country` (confirmed the field
  exists: `apps/api/src/organizations/schemas/organization.schema.ts`). No match →
  `PAYMENT_PROVIDER_NOT_CONFIGURED` (`UnprocessableEntityException`), never a silent
  `ManualPaymentProvider` fallback. `PaymentProviderRegistry` registers only `'manual'` in Stage 1,
  with the Flutterwave/ChariBaaS slots left as commented-out map entries for Stage 2 — exactly the
  "single new Map entry" extension path §4 describes.
- **Webhook idempotency (§6/§7).** `IntegrationWebhookEvent`'s unique index on
  `(provider, providerEventId)` is enforced by MongoDB itself via a single atomic `create()`
  (`IntegrationWebhookRepository.claimIfNew`), not a read-then-write — a losing concurrent insert
  is caught as E11000 and reported as `{ inserted: false }`. `IntegrationWebhookService.process`
  fails closed (nothing persisted, nothing published) on `verifier.verify() === false`, and only the
  delivery that wins the insert calls `EventBusService.publish`. The structured log line
  (`integration`, `provider`, `organizationId`, `eventType`, `eventId`, `status`, `durationMs`)
  matches §6's spec field-for-field and never includes the raw payload/headers.
- **New `SystemEvent`s (§6).** `'payment.webhook_received'` and `'whatsapp.status_updated'` are both
  present in `packages/types/src/workflow.ts`'s `SYSTEM_EVENTS`.
- **`Settlement` domain shape (§4 "Split settlement").** `packages/types/src/settlement.ts` and
  `apps/api/src/finance/settlement/schemas/settlement.schema.ts` agree; `computeCommission` derives
  `tenantAmount` as the exact remainder of `grossAmount - commissionAmount` (never independently
  rounded), guaranteeing the invariant `commissionAmount + tenantAmount === grossAmount` holds for
  every input. `SettlementService` never calls a `PaymentProvider` or any HTTP client — matches
  "`SettlementService` calls the adapter, not the other way around" exactly, because Stage 1 builds
  only the domain-logic skeleton, with no adapter to call yet.

### 11.2 Real deviations from the design (verified against code)

**1. Rotation-safe partial indexes (confirmed, as I described).** The design's §2 indexes
(`{scope,domain,provider,market,role}` unique partial on `scope:'platform'`, and
`{organizationId,domain,provider}` unique partial on `scope:'tenant'`) would indeed collide the
instant a row was rotated, since inserting a new row with the same key fields while the old one
still exists violates a uniqueness constraint keyed only on `scope`. The shipped schema
(`integration-account.schema.ts` lines 92-120) resolves this by extending both partial filter
expressions to also exclude `status: 'revoked'`: `partialFilterExpression: { scope: 'platform',
status: { $ne: 'revoked' } }` (and the tenant equivalent). This preserves the intended invariant —
at most one *live* (non-revoked) row per key — while letting unlimited revoked rows accumulate for
audit history, which is exactly what §3's "insert new + mark old revoked, keep both" rotation
contract requires. The reasoning is documented in the schema file's own comment, not just inferred.

**2. `MessagingSendResult.status: 'read'` has no `Message.status` counterpart (confirmed, as I
described, with one added detail).** `MessagingSendResult.status` in
`messaging-provider.interface.ts` was extended to `'sent' | 'delivered' | 'read' | 'failed'` as
designed, but `MessageStatus` in `packages/types/src/communication.ts` still has only `'queued' |
'sent' | 'failed' | 'delivered' | 'bounced' | 'complained'` — no `'read'`. This was caught as a
compile break during Wave 4 convergence (commit `adc4228`, outside any single agent's file
ownership) and fixed in `conversations.service.ts`: the local `status` variable was widened from
`'sent' | 'failed'` to the full `MessageStatus` type, and the mapping is `status = result.status ===
'read' ? 'delivered' : result.status` — a `'read'` receipt from a provider is deliberately degraded
to `'delivered'`, the closest state `Message` actually models, rather than widening the shared
`MessageStatus` type for a value no Stage 1 provider ever produces (the only implementation,
`LogMessagingProvider`, always returns `'sent'`). This is a real, intentional design gap left open
for Stage 2 (a real WhatsApp read-receipt would need `Message.status` to grow a `'read'` value, plus
a UI treatment for it) — recorded here rather than silently patched over.

**3. None of the four Stage 1 modules are registered in `app.module.ts`/`finance.module.ts`/
`communication.module.ts` (confirmed, as I described).** Verified directly:
`IntegrationsModule`, `IntegrationWebhookModule`, `SettlementModule`, and `MessagingProviderModule`
do not appear anywhere in `apps/api/src/app.module.ts`, `apps/api/src/finance/finance.module.ts`, or
`apps/api/src/communication/communication.module.ts`. `FinanceModule` still binds `PAYMENT_PROVIDER`
via the original `{ provide: PAYMENT_PROVIDER, useClass: ManualPaymentProvider }`, and
`CommunicationModule` still binds `MESSAGING_PROVIDER` via the original
`{ provide: MESSAGING_PROVIDER, useClass: LogMessagingProvider }`. Every new module's own doc
comment states this is deliberate ("the orchestrator wires it in at Wave 4 convergence to avoid a
shared-file collision with the other Stage 1 agents"), and the running app's behavior is
byte-for-byte unchanged — this is a genuine zero-behavioral-change Stage 1, not an oversight.
Additionally worth noting for Stage 2 scoping: `IntegrationWebhookModule` ships **no HTTP
controller at all** yet (not just "unregistered" — there is no
`flutterwave-webhook.controller.ts`/`360dialog-webhook.controller.ts` equivalent of
`resend-webhook.controller.ts` in this lot), so wiring Stage 2 requires writing that controller in
addition to registering the module. To wire each in for Stage 2:
  - `IntegrationsModule` → import into `app.module.ts` (or a shared "platform" module); no other
    change needed, it's self-contained.
  - `IntegrationWebhookModule` → import into `app.module.ts`; also requires writing the actual
    provider-specific webhook controller(s) that call `IntegrationWebhookService.process` with a
    real `WebhookVerifier` and `extractEventId`, since Stage 1 ships no controller.
  - `SettlementModule` → import into `finance.module.ts`; also requires a real call site (e.g. from
    `PaymentsService` on payment completion) since nothing invokes `SettlementService` today outside
    its own tests.
  - `MessagingProviderModule` → see item 4 below; requires removing `CommunicationModule`'s existing
    inline `useClass: LogMessagingProvider` binding and importing this module in its place.

**4. `MessagingProviderModule`'s factory is not imported by `CommunicationModule`; it is fully
standalone (confirmed, as I described).** `apps/api/src/communication/communication.module.ts` line
70 still reads `{ provide: MESSAGING_PROVIDER, useClass: LogMessagingProvider }` — the pre-existing
binding, untouched. `MessagingProviderModule`'s own doc comment confirms this explicitly: "This
module is standalone in Stage 1: it is not yet imported by `CommunicationModule`... Rewiring
`CommunicationModule` to import this module instead is Stage 2/later, not this task." The factory
itself (`messaging-provider.module.ts`) also does not actually branch on `'360dialog'` yet — every
config value, including `'360dialog'`, currently falls back to `LogMessagingProvider`, since no real
adapter exists to construct. The `if (providerKey === '360dialog')` branch is left as a comment for
Stage 2 to fill in, consistent with the "no fake completeness" mandate (never pretend to deliver a
WhatsApp message via an adapter that doesn't exist).

### 11.3 Additional deviations found (not on the known list)

- **`send()` was never renamed to `sendSessionReply()`.** §5 specified `sendSessionReply` as "existing
  `send()`, renamed for clarity." The shipped `MessagingProvider` interface
  (`messaging-provider.interface.ts`) keeps the original `send({ to, body })` method name unchanged
  and instead adds `sendTemplate` as a new, **optional** method (`sendTemplate?(...)`), explicitly
  to avoid breaking existing implementers mid-Stage-1. `grep` for `sendSessionReply` across
  `apps/api/src/` returns no matches. This is a smaller, backward-compatible version of §5's
  intended shape — real behavior is unaffected (only `LogMessagingProvider` implements the
  interface today, and it implements both `send` and `sendTemplate`), but a future Stage 2 caller
  wanting `sendTemplate` semantics must still check for its presence (or a real adapter must always
  implement it) since the interface makes it optional rather than mandatory.
- **`Contact.consents` (the opt-in gate) was not built at all in Stage 1.** §5's "Opt-in gate"
  paragraph specifies a new `Contact.consents` array field. No such field exists anywhere in the
  codebase as of this commit (`grep -rn "consents" apps/api/src/crm/ packages/types/src/` returns
  nothing). This tracks with §8's Stage 1 lot list, which does list `Contact.consents` under
  `FOUND-MESSAGING-FACTORY` but the delivered lot only built the factory + interface extension, not
  the consent model — worth flagging explicitly for Stage 2 scoping since `sendTemplate`'s
  opt-in check has nothing to check against yet.

### 11.4 Corrections to §1-§10's own prose (design claims that turned out subtly off)

- None found. Every concrete codebase claim in §1-§10 that Stage 1 code could be checked against
  (the `PaymentProvider` interface shape, `Organization.country`'s existence, `ApiKey` rotation's
  insert-new/mark-old-revoked pattern, `two-factor.service.ts`'s own "marginally better hygiene"
  doc comment, `EventBusService`/BullMQ as the publish target) held up exactly as described. The
  design doc's own hedges (§9's "nothing here is production-ready," §8's "file-disjoint" agent
  ownership) also held — no cross-agent file collisions surfaced in the merge history.
