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
