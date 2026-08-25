# WhatsApp Provider Decision Record

## Status
Proposed — awaiting KORVA stakeholder confirmation

## Context

KORVA OS already ships a clean `MessagingProvider` abstraction
(`apps/api/src/communication/providers/messaging-provider.interface.ts`) with a single
`send({ to, body }) → { providerReference, status }` method. Today it has exactly one
implementation, `LogMessagingProvider` (`apps/api/src/communication/providers/log-messaging.provider.ts`),
which logs instead of sending. `.env.example` declares an unused `WHATSAPP_API_KEY` placeholder
(line 62) and no `*.module.ts` currently wires a real provider behind it. This mirrors the
pattern already used for `EmailProvider` (`ResendEmailProvider` vs `LogEmailProvider`), so the
integration point and factory pattern to follow are already established in the codebase.

**Repo evidence of intended use cases** (grepped `apps/api/src/communication/`, `apps/api/src/workflow/`,
`apps/api/src/ai/`, and `docs/`):

- **Channel model**: `Conversation.channel` is one of `email | whatsapp | sms | internal`
  (`apps/api/src/communication/conversations/schemas/conversation.schema.ts`,
  `docs/database.md:152`). Sending a message on a `whatsapp`/`sms` conversation resolves the
  contact's `phone` field and calls `MessagingProvider.send()`
  (`apps/api/src/communication/conversations/conversations.service.ts:211-224`); it throws
  `CONTACT_HAS_NO_PHONE` if absent.
- **Templates exist but have no approval-state field.** `MessageTemplate`
  (`apps/api/src/communication/message-templates/schemas/message-template.schema.ts`) is just
  `{ organizationId, name, channel, subject?, body }` — freeform text, interpolated with
  `{{contact.firstName}}` etc. at send time. There is **no concept of a pre-approved/rejected
  template status** anywhere in the schema or service. This is a real gap versus WhatsApp's
  requirement that all business-initiated (outside-24h-window) messages use a Meta-approved
  template — whichever provider is chosen, KORVA will need to add template-approval-state
  tracking before WhatsApp send is switched on for real.
- **AI tool `send_whatsapp`** (`apps/api/src/ai/tools/send-whatsapp.tool.ts`) opens or reuses an
  open `whatsapp` conversation for a contact and sends a freeform `body` — i.e., the AI agent can
  already message a customer for whatsapp/sms today via the log stub. Per
  `docs/PRODUCTION_READINESS.md:101/225`, this tool is **not** gated behind the `AiPendingAction`
  human-confirmation mechanism (only `cancel_booking` is), so it executes immediately — a real
  provider switch-on should reconsider this gate.
- **Workflow automation does NOT yet send WhatsApp.** `apps/api/src/workflow/workflow-actions.service.ts`
  only implements `create_task`, `send_email`, `call_webhook`, `notify_organization` as workflow
  action types — there is no `send_whatsapp` workflow action. So automated booking/order
  confirmations over WhatsApp are **architecture-ready but not built**; the only live path to
  WhatsApp today is (a) a staff member replying inside the Communication conversations UI, or
  (b) the AI agent's `send_whatsapp` tool. This matters for the pricing-category analysis below:
  KORVA's actual near-term traffic looks like **service-window replies to existing conversations**
  (free/cheap under WhatsApp's model) far more than **business-initiated notification templates**
  (paid from message 1) — until a `send_whatsapp` workflow action is built for booking/order
  events, which `docs/architecture-decisions.md` and `docs/IMPLEMENTATION_PLAN.md` both flag as
  future/out-of-scope-for-MVP.
- **2FA is TOTP-based, not SMS.** `apps/api/src/identity/auth/two-factor.service.ts` implements
  RFC 6238 TOTP via `otpauth`, keyed off `JWT_SECRET`, with no SMS/WhatsApp OTP delivery anywhere
  in the auth flow. **SMS/WhatsApp OTP is not a live KORVA use case** — Authentication-category
  templates matter only if a future product decision reintroduces phone-based OTP (e.g., as a
  lower-friction 2FA option, or WhatsApp-based magic links), not for anything currently built.
- **Docs consistently describe WhatsApp as "architecture-ready, not integrated"**: `docs/api.md:234`,
  `docs/architecture.md:59`, `docs/security.md:50`, `docs/ai.md:131`, `docs/IMPLEMENTATION_PLAN.md:262/272`,
  and `docs/PRODUCTION_READINESS.md:100/271/362/379` all say the same thing — `LogMessagingProvider`
  only, no real Twilio/WhatsApp Business API integration, explicitly deferred to "Phase 8" /
  P1-for-launch. `docs/PRODUCTION_READINESS.md:379` is the only place in the repo that names a
  candidate provider, and it names **Twilio** (alongside generic "WhatsApp Business API") as the
  example — no other BSP name (360dialog, Infobip, MessageBird/Bird, Vonage, Gupshup, Wati) appears
  anywhere in the repo.

**Target markets — genuine repo evidence.** The onboarding form's country/currency pickers
(`apps/web/src/app/onboarding/page.tsx:25-34`) are the only place in the repo where target markets
are enumerated as data rather than architecture prose:

```
COUNTRIES = France (FR), Côte d'Ivoire (CI), Sénégal (SN), Maroc (MA), Belgique (BE), Canada (CA)
CURRENCIES = EUR, XOF, MAD, USD, CAD
```

This confirms **Morocco and Côte d'Ivoire** (the two markets specified for this record, kept
consistent with the companion PSP decision record) are genuinely modeled, and additionally
surfaces **Sénégal** (also XOF, also a strong WhatsApp-first market in Francophone West Africa —
worth keeping in mind since a WABA/BSP choice that works for Côte d'Ivoire will very likely also
cover Sénégal with no extra integration work) plus France/Belgium/Canada, which are mature,
low-risk WhatsApp Business API markets with no special nuance and are not analyzed in depth below.

## Markets evaluated

Morocco (MA), Côte d'Ivoire (CI) — primary, per task scope and consistent with the companion PSP
decision record. Sénégal (SN) noted as a low-incremental-risk adjacent market given repo evidence.

## Providers evaluated

- **Meta WhatsApp Cloud API** (direct, official)
- **Twilio** (BSP layer over WhatsApp Business API) — the only provider explicitly named in the repo
- **360dialog** — official WhatsApp BSP with an explicit Africa pricing tier and multi-tenant/ISV tooling
- **Infobip, Gupshup, Vonage, MessageBird/Bird, Wati** — surveyed as prominent alternative BSPs; not
  carried into the deep comparison because research surfaced no material differentiator for
  Morocco/Côte d'Ivoire specifically beyond what 360dialog and Twilio already establish as the
  BSP-model pattern (see Comparison notes)

## Comparison

| Criterion | Meta WhatsApp Cloud API (direct) | Twilio (BSP) | 360dialog (BSP) |
|---|---|---|---|
| **Availability in MA/CI** | Yes — WhatsApp Business Platform has no blanket country restriction for Morocco or Côte d'Ivoire; either country's local numbers (+212 / +225) can register a WABA. No repo-independent source confirmed country-specific WABA rollout blockers for either market at time of writing — this should be spot-checked against Meta's current supported-countries list before implementation, not assumed indefinitely stable. | Same underlying Meta rails — same availability | Same underlying Meta rails — same availability; markets an explicit **Africa pricing tier from €47/mo** ([360dialog](https://360dialog.com/pricing)), signaling deliberate African-market focus |
| **Template approval** | Direct via Meta Business Manager / Cloud API `message_templates` endpoint. Machine review typically minutes–hours, human review up to ~24h ([Wati](https://support.wati.io/en/articles/12320234-understanding-meta-s-latest-updates-on-template-approval), [devdarren.com](https://devdarren.com/blog/whatsapp-api-template-message-approval-tips)). Since Jan 1 2026, templates with call-to-action/URL buttons must use verifiable HTTPS URLs or are rejected at creation. KORVA submits and manages templates itself. | Same Meta review pipeline, submitted through Twilio's console/API — Twilio does not shorten or bypass Meta's review | Same Meta review pipeline via 360dialog's dashboard/API |
| **Pricing model (2026)** | **Material finding**: conversation-based pricing was **deprecated July 1, 2025** — WhatsApp Business Platform now bills **per delivered template message**, by category (Marketing / Utility / Authentication / Service) and recipient country, not per 24h conversation window. **From October 1, 2026, Meta additionally begins charging per business message for service replies and utility messages inside the 24h window** (previously free) — Meta had not published the exact October rates as of this research; confirm before budgeting. Meta bills directly, no markup. | Twilio passes through Meta's per-message price **plus a per-message platform fee** (reported ~US$0.005/msg in general Twilio pricing pages) plus Twilio's own phone-number rental. Adds a second billing layer and a second place pricing can change. | 360dialog states "zero message markup" — passes Meta's per-message cost through unmarked-up, charging instead a **flat per-WABA-number monthly platform fee** (from ~€47–59/mo). Simpler to reason about margin-wise for a multi-tenant SaaS reselling the channel. |
| **Webhooks (inbound + delivery/read receipts)** | Yes, native — Meta Cloud API webhooks for messages, statuses (sent/delivered/read/failed) | Yes, via Twilio's own webhook layer (re-wraps Meta's webhook payload into Twilio's format) | Yes, native passthrough of Meta's webhook payload |
| **Auth/OTP template category** | Supported, not currently relevant — KORVA's 2FA is TOTP (`two-factor.service.ts`), no SMS/WhatsApp OTP delivery exists in the codebase today. Note only for future optionality. | Same | Same |
| **Transactional/Utility notifications (booking/order confirmations — KORVA's actual near-term use case)** | Fully supported once a `send_whatsapp` workflow action is built (does not exist yet, see Context) | Same | Same |
| **Rate limits for new/unverified number** | Starts at **Tier 0: 250 business-initiated conversations/24h** while unverified. Meta Business Verification (typically 2–5 business days, up to ~14 if documents incomplete, occasionally reported up to a few weeks) unlocks Tier 1 (1,000/24h), then progressive tiers to 10,000 → 100,000 → unlimited based on quality rating and sustained volume (≥50% of current tier used over 7 days). | Same underlying Meta tiers — Twilio does not grant higher default tiers | Same underlying Meta tiers |
| **Compliance/opt-in** | Meta mandates explicit opt-in for all business-initiated messages, including template messages outside the 24h window; a customer messaging first does not itself constitute opt-in for proactive outreach. Since Nov 2024 a general marketing opt-in (not WhatsApp-specific) satisfies this. Identical obligation regardless of provider — this is a Meta platform policy, not a per-provider one. | Same | Same |
| **Operational simplicity** | Self-serve for a *first* number/app via Meta App Dashboard (free test number generated automatically, "hello world" template pre-approved) — but scaling to **one WABA per KORVA tenant** requires becoming a Meta **Tech Provider** (App Review + Business Verification + Access Verification for KORVA itself), then using **Embedded Signup** to onboard each tenant. This is a real build: KORVA owns the Meta relationship, the compliance surface, and the App Review process. | Twilio sales/self-serve hybrid — WhatsApp senders still require Meta Business/WABA registration, but Twilio's **ISV/Tech Provider Program** wraps embedded signup so KORVA doesn't need its own Meta Tech Provider status; Twilio operates as the intermediary Business Solution Provider. Materially less upfront Meta-relationship work for KORVA. | 360dialog explicitly markets "instant client provisioning" for SaaS/ISV multi-tenant use, handling the Meta relationship and per-customer WABA provisioning as a packaged partner flow — similar operational-simplicity profile to Twilio, purpose-built for this exact SaaS-reseller scenario. |
| **Dependency risk** | No intermediary — KORVA talks directly to Meta's API. Lower vendor-chain risk, but KORVA absorbs 100% of Meta policy/API-change risk and Tech Provider compliance burden itself. | Adds Twilio as a layer between KORVA and Meta: extra point of billing/API/outage risk, extra support relationship, extra fee. In exchange, Twilio absorbs the Tech Provider/Meta-relationship complexity. | Same tradeoff shape as Twilio — 360dialog is the intermediary — but 360dialog is a WhatsApp-only BSP (narrower, more specialized) vs. Twilio's general communications platform; "zero markup" claim reduces (but doesn't eliminate) the cost-layering risk. |
| **Sandbox/test number for dev** | Yes — Meta auto-generates a free test business phone number + WABA ID in the App Dashboard flow, with a pre-approved "hello world" template, no Business Verification needed to start testing. | Yes — Twilio's shared WhatsApp Sandbox number (+14155238886); testers join via a code; 3-day session expiry; ~1 msg/3 sec; no WABA required for sandbox testing. | 360dialog's flow is provisioning-oriented (real WABA per client from day one via embedded signup) — less of a distinct "sandbox" concept; Meta's own free test number is available underneath it either way. |
| **Node.js/NestJS integration** | No official Meta Node SDK — raw REST (`fetch`/`axios` against `graph.facebook.com/v.../messages`), fully typeable by KORVA with a thin DTO, consistent with how `ResendEmailProvider` already wraps a REST API in this repo. | **Official `twilio` npm package**, has community TypeScript types, well-documented Node quickstarts; slightly less integration code to write than raw Meta REST. | REST API, comparable integration effort to direct Meta Cloud API (thin wrapper, no official Node SDK found in this research). |
| **Multi-tenant fit (see dedicated section below)** | KORVA becomes a Meta Tech Provider; each tenant gets its own WABA via KORVA-embedded signup, owned by the tenant, with KORVA holding the technical access token per WABA. | Twilio's ISV/Tech Provider Program gives the same "one WABA per tenant via embedded signup" model, but Twilio (not KORVA) carries the Meta Tech Provider relationship. | Explicitly designed and marketed for exactly this: automated per-customer WABA provisioning as part of an embedded-signup partner flow. |

## Architectural consideration: shared sender vs. per-tenant WABA

Research strongly indicates this is **not really an open design choice** — it is close to a hard
constraint of the WhatsApp Business Platform itself:

- A WhatsApp Business Account (WABA) and its phone number carry **one display name and one
  business identity**. There is no mechanism found in this research for two unrelated end-customer
  businesses (KORVA tenants) to send under *different* customer-facing brand identities from a
  single shared WABA/number. A shared-sender model would mean every KORVA tenant's customers see
  messages arriving from the *same* WhatsApp business identity ("KORVA", not "Tenant A's Salon") —
  workable only if KORVA intends to be the customer-facing brand for every tenant's WhatsApp
  channel, which contradicts a multi-tenant SaaS where each tenant is its own customer-facing
  business (consistent with how KORVA already models `Organization.name`/`legalName` per tenant,
  `docs/database.md:59`).
- The standard, well-documented pattern for exactly this situation — a SaaS platform whose
  end-customers each need their own WhatsApp presence — is **per-tenant WABA provisioned via
  Meta's Embedded Signup flow**, orchestrated by a **Tech Provider** (either KORVA itself, or a BSP
  acting as Tech Provider on KORVA's behalf). Under Embedded Signup, the **tenant owns its own
  WABA and assets**, but the Tech Provider (KORVA or its BSP) holds the API/access token used to
  send on the tenant's behalf and typically does not require the tenant to separately complete
  their own from-scratch Meta Business Verification — verification burden concentrates on the Tech
  Provider, not each end tenant. This is a materially easier onboarding experience for KORVA's
  tenants than "go get your own Meta Business verified independently," but it still means: **every
  KORVA tenant that wants WhatsApp needs its own WABA and its own WhatsApp Business phone number**
  (their own number, not shared), even though the *verification/compliance* burden is absorbed
  upstream by KORVA or its BSP.
- **Where direct Meta Cloud API and BSPs (Twilio, 360dialog) actually differ** is not whether
  per-tenant WABAs are needed (both require them) — it's **who carries the Tech Provider
  relationship with Meta**: KORVA itself (direct Cloud API path) vs. the BSP (Twilio/360dialog
  path). Choosing direct Cloud API means KORVA must become and remain a Meta Tech Provider (App
  Review, Business Verification, ongoing Meta policy compliance as the intermediary for all
  tenants). Choosing a BSP hands that relationship — and its ongoing maintenance burden — to the
  BSP, at the cost of an extra vendor layer and (for Twilio) an extra per-message fee.

## Recommendation

This is **not a case where the evidence forces a single confident pick** — it genuinely depends on
an unresolved business-model question KORVA has not yet answered: **is KORVA willing to become and
operate as its own Meta Tech Provider** (own the App Review/Business Verification relationship,
absorb 100% of Meta policy risk, and provision tenant WABAs itself via Embedded Signup), **or does
KORVA prefer to buy that relationship as a managed service from a BSP** for a per-number monthly
fee (360dialog) or a per-message markup (Twilio)?

- If KORVA's near-term WhatsApp footprint stays small (a handful of pilot tenants, still validating
  product-market fit for the channel, consistent with the repo's current state — no
  `send_whatsapp` workflow action exists yet, and templates have no approval-state tracking to
  build first regardless of provider) — the pragmatic starting point is a **BSP**, because it
  removes the Meta Tech Provider onboarding burden from KORVA's critical path entirely and lets
  KORVA validate demand before investing in owning the Meta relationship. Between the two BSPs
  researched: **360dialog's flat per-number fee + "zero markup" pass-through pricing is more
  predictable for a margin-sensitive multi-tenant reseller** than Twilio's per-message fee stacked
  on top of Meta's own per-message pricing, and 360dialog's explicit Africa pricing tier and
  ISV/multi-tenant provisioning tooling is a closer fit to KORVA's actual Morocco/Côte d'Ivoire
  target markets than Twilio's general-purpose platform. **Twilio's practical edge is the official
  Node.js SDK with TypeScript-friendly typings**, which is a genuine integration-speed advantage
  over 360dialog/direct Meta's raw-REST approach — a factor worth weighing if engineering time is
  the binding constraint rather than per-message margin.
- If KORVA expects WhatsApp to become a core, high-volume channel across many tenants and wants to
  avoid a permanent vendor fee layered on every message, **direct Meta Cloud API as a self-operated
  Tech Provider** is the better long-term position — but it is meaningfully more upfront work
  (KORVA's own App Review + Business Verification + Embedded Signup integration) and makes KORVA
  solely responsible for staying current with Meta's policy changes (the July 2025 and October 2026
  pricing-model changes found in this research illustrate how frequently the ground shifts).

Given the repo shows WhatsApp send is still architecture-only (no workflow action exists to
actually trigger it), the lowest-risk sequencing is: **start with a BSP (360dialog or Twilio) to
unblock the first real integration and validate the channel with pilot tenants, while deferring the
"become our own Tech Provider" decision until KORVA has evidence of real per-tenant WhatsApp
volume** that would justify absorbing the Meta relationship directly.

## Open questions requiring stakeholder confirmation

1. **Per-tenant WABA is very likely mandatory regardless of provider choice** (see architectural
   section) — confirm KORVA accepts that every tenant wanting WhatsApp needs its own WhatsApp
   Business phone number/WABA, not a shared KORVA-branded sender, and budget onboarding UX for
   tenants to complete Embedded Signup.
2. Does KORVA want to become a Meta Tech Provider itself (direct Cloud API, more control, more
   ongoing compliance burden), or buy that relationship from a BSP (360dialog/Twilio, faster to
   ship, recurring per-number or per-message fee)? This is the single biggest fork in this
   document and was left open rather than force-picked.
3. What is KORVA's expected per-tenant, per-month WhatsApp message volume? This determines whether
   360dialog's flat monthly fee or Twilio's per-message markup is cheaper in practice, and whether
   direct Cloud API's larger upfront investment pays back.
4. Who owns and pays for template content/design and the ongoing template-approval-status tracking
   this integration will require adding to `MessageTemplate` (currently has no approval-state
   field at all)?
5. Should `send_whatsapp` (AI tool) be added to the `AiPendingAction` human-confirmation gate before
   a real provider goes live, given it currently executes immediately with no human review
   (`docs/PRODUCTION_READINESS.md:101/225`)?
6. Confirm current Meta country availability for Morocco (+212) and Côte d'Ivoire (+225) WABA
   phone-number registration directly against Meta's supported-countries documentation at
   implementation time — this research found no evidence of a blocking restriction for either
   market, but also found no authoritative, country-by-country confirmation page to cite directly;
   this should be a pre-implementation spike, not an assumption carried into a build.
7. Should Sénégal (also in the onboarding `COUNTRIES` list, also XOF) be included in the initial
   WhatsApp rollout scope given it likely requires no additional integration work beyond
   Morocco/Côte d'Ivoire?
8. Confirm the October 1, 2026 Meta pricing change (service-window utility/service messages
   becoming chargeable) against Meta's officially published rates once available — this research
   was conducted before Meta's committed September 1, 2026 publication date for exact figures, so
   budget estimates using current per-message rates should be treated as provisional.

## Wave 3 refinement (2026-08-25) — verification, webhooks, opt-in, credential storage

This section was added by a Wave 3 refinement pass. It does **not** redo the provider/market/pricing
research above — that was re-verified against the current codebase and found still accurate — and
instead deepens four specific points and records one important cross-cutting finding on credential
storage.

### Verification against current codebase (commit `d52de50`)

Re-checked every repo-evidence claim above directly against `d52de50`:

- `apps/api/src/communication/providers/messaging-provider.interface.ts` is unchanged — still a
  single `send({ to, body }) → { providerReference, status }` method, no template/category/opt-in
  parameters.
- `apps/api/src/communication/communication.module.ts` still binds `MESSAGING_PROVIDER` to
  `LogMessagingProvider` via a plain `useClass`, with **no env-var-driven factory** — this is
  actually a smaller gap than `EMAIL_PROVIDER`'s wiring: `apps/api/src/shared/email/email.module.ts`
  already has a `useFactory` that switches between `ResendEmailProvider`/`LogEmailProvider` based on
  `EMAIL_PROVIDER`/`RESEND_API_KEY` config. `CommunicationModule` has not even been given the
  equivalent factory scaffold yet for `MESSAGING_PROVIDER`, so the very first step of wiring in any
  real WhatsApp provider is copying that factory pattern before a provider class is written at all.
- `send_whatsapp` workflow action still does not exist in `workflow-actions.service.ts`; 2FA is
  still TOTP-only (`two-factor.service.ts`); `MessageTemplate` still has no approval-state field.
  All still accurate.
- **Wave 2.1 (this branch's base commit) completed the Resend webhook receiver** — confirmed by
  reading `apps/api/src/communication/webhooks/resend-webhook.controller.ts`,
  `resend-webhook.service.ts`, and `verify-svix-signature.ts` in full. This is now a fully working,
  tested pattern in the codebase and is directly relevant to what a WhatsApp delivery-status webhook
  would need (see below) — the original decision record did not reference it because it predates
  Wave 2.1's completion of that webhook.

### The Resend webhook as an explicit template for a future WhatsApp delivery-status webhook

The Resend webhook pattern is a strong structural template, and the differences are worth spelling
out concretely rather than just gesturing at "similar":

**What transfers directly:**
- `@Public()` controller, no JWT/tenant context — the only trust boundary is the signature.
- Raw-bytes requirement: `req.rawBody`, populated via `NestFactory.create(AppModule, { rawBody: true })`
  in `main.ts`, is verified *before* JSON parsing — signature verification over a re-serialized body
  is unreliable and this codebase already learned that lesson once (see the controller's comment
  about the `!rawBody` 503 guard).
- Constant-time comparison (`timingSafeEqual`) rather than `===` on the computed HMAC.
- `@Throttle` on the endpoint (public + unauthenticated + externally triggered = abuse surface).
- Idempotency via a repository-level guard that only applies an incoming status if it doesn't
  regress an already-newer status (`MessagesRepository.updateStatusByProviderReference`) — this
  pattern transfers almost unchanged to WhatsApp: Meta's per-message status webhooks arrive as
  `sent → delivered → read` (or `failed`), keyed by WhatsApp's own `messages[].id`, which would
  become the `providerReference` exactly the way Resend's `email_id` is used today.
- Acknowledge-and-ignore-unknown-events posture (`EVENT_TO_STATUS` partial map, unhandled types
  logged and 200'd, not errored) — same shape works for WhatsApp's broader webhook payload (which
  also carries inbound message events, not just status events, in the same webhook stream).

**What does NOT transfer and would need provider-specific work** (stated from general platform
documentation; not re-verified via new web research in this pass — confirm exact current header
names/algorithms against each provider's docs before implementing):
- **Meta Cloud API** signs webhooks with `X-Hub-Signature-256` (HMAC-SHA256 over the raw body, keyed
  by the Meta **App Secret**, not a per-WABA secret) — structurally close to Svix (HMAC over raw
  bytes, constant-time compare) but a different header and no built-in replay-window timestamp the
  way Svix's `svix-timestamp` provides; replay protection would have to lean on the idempotency guard
  above rather than a timestamp check.
- **Twilio** signs with `X-Twilio-Signature`, computed differently again (HMAC-SHA1 over the full
  callback URL plus sorted POST parameters, not a raw-body HMAC) — meaningfully different enough
  that `verify-svix-signature.ts` could not be reused as-is; Twilio's SDK ships its own
  `validateRequest` helper for this.
- **360dialog** passes through Meta's native webhook format, so it follows the Meta Cloud API
  signature scheme above, not a scheme of its own.
- Meta also requires a one-time **GET verification handshake** at webhook registration
  (`hub.mode=subscribe&hub.verify_token=...`, echoed back to confirm ownership) — Resend's webhook
  model has no equivalent step, so a WhatsApp webhook controller needs an extra GET handler the
  Resend template doesn't demonstrate.

Net: the existing record should be read as already correctly implying "webhooks are supported by
every candidate" (true) but the original text did not spell out that a **new, provider-specific
signature-verification module** is still required either way — `verify-svix-signature.ts` is a
template for *shape*, not a drop-in dependency.

### Opt-in / opt-out

Checked `apps/api/src/crm/contacts/schemas/contact.schema.ts` in full: fields are `organizationId`,
`type`, `firstName`, `lastName`, `company`, `email`, `phone`, `tags`, `customFields` (freeform
object). **There is no opt-in, consent, or per-channel marketing-preference field of any kind.**
This is a genuine gap, independent of provider choice (Meta's opt-in requirement is a platform
policy, not a per-provider one, consistent with what the original record already says).

What would need to be added, at minimum:
- A consent record per contact — not just a boolean, since Meta expects a business to be able to
  demonstrate *how and when* consent was obtained (e.g. `{ channel: 'whatsapp', grantedAt, source,
  revokedAt? }`, plausibly generalized across channels rather than WhatsApp-specific, given `tags`/
  `customFields` already show a preference for generic contact modeling in this schema).
- An enforcement point in the send path. `apps/api/src/communication/conversations/conversations.service.ts:211-224`
  today only checks that `contact.phone` is present before calling `MessagingProvider.send()` — it
  has no concept of opt-in at all. This check should stay permissive for **replies inside a
  customer-initiated conversation** (no additional Meta opt-in required within an active session)
  but would need a new guard for **business-initiated sends** (proactive template messages, e.g. a
  future `send_whatsapp` workflow action or the AI tool triggering a new conversation) — which is
  exactly the send path that doesn't exist yet per the original record's Context section, so this
  can be built alongside it rather than retrofitted.

### Tenant isolation / multi-tenant credential model — the deepest gap, and a cross-cutting finding

Grepped the full `apps/api/src` tree for `IntegrationCredential`, `integration-credential`, and
`IntegrationConfig` — **zero matches**. Also checked `apps/api/src/organizations/schemas/` for any
`apiKey`/`credential`/`secret` field — none. **No per-organization credential store exists anywhere
in this codebase today.**

Every external provider secret currently in use is a single, global, process-wide environment
variable, read once via `ConfigService` at boot:
- `RESEND_API_KEY` (email)
- `STRIPE_SECRET_KEY`, `CINETPAY_API_KEY`, `PAYSTACK_SECRET_KEY` (payments)
- `WHATSAPP_API_KEY` (the current unused placeholder this whole record is about)

`apps/api/src/shared/email/email.module.ts` is the closest thing to a "provider selection" pattern
in the repo (a `useFactory` choosing `ResendEmailProvider` vs. `LogEmailProvider` based on
`EMAIL_PROVIDER`/`RESEND_API_KEY`), but it only switches between two **globally-configured**
implementations — it does not parametrize per tenant. There is no mechanism anywhere for "tenant A's
credentials" to differ from "tenant B's credentials" for any provider, WhatsApp included.

This flatly contradicts what the record's own architectural section concludes: **every KORVA tenant
that wants WhatsApp needs its own WABA and its own access token** (Embedded Signup per tenant,
Tech-Provider-held token per tenant). That per-tenant token has nowhere to live in the current data
model — it cannot be a global env var the way `WHATSAPP_API_KEY` is today.

**Cross-cutting finding.** The companion PSP decision record (`docs/decisions/psp-provider.md:31-33,82`)
independently reaches the identical conclusion for payment providers: *"there is no per-organization
provider credential concept anywhere in identity/organizations/finance"*, and that a tenant-owns-
account model would require the `PaymentProvider` DI wiring to become per-tenant instead of a single
global injection token — *"a non-trivial change to the current DI wiring."* **This is now two
independent decision records (PSP and WhatsApp) converging on the exact same missing prerequisite.**
That strongly suggests the real next architectural investment is not "pick a WhatsApp provider" or
"pick a PSP" in isolation, but building a shared, general-purpose **per-organization integration
credential store** once — encrypted-at-rest secrets keyed by `(organizationId, providerType)`, with
provider clients instantiated per-request/per-tenant instead of once at DI-container boot — since
both of these integrations (and likely future ones — accounting sync, calendar sync, SMS) need the
same primitive. Building bespoke per-tenant credential handling twice, once for payments and once
for messaging, would be redundant work relative to building this foundation once and having both
consume it.

**Recommendation update**: if KORVA proceeds toward the "tenant connects their own WABA" model this
record already concludes is close to mandatory, treat **"build a per-tenant IntegrationCredential
model"** as a shared prerequisite epic ahead of both the WhatsApp and PSP tenant-owned-account paths,
not as WhatsApp-specific scope. This does not change the provider recommendation above (BSP-first,
defer becoming a Meta Tech Provider) — it adds a data-model prerequisite that sits underneath
whichever provider is chosen, and is arguably more urgent to resolve than the provider pick itself.

### Templates — checked for completeness, no material gap found

Re-read the existing Comparison table's "Template approval" row against the codebase: confirmed
`MessageTemplate` (`apps/api/src/communication/message-templates/schemas/message-template.schema.ts`)
still has no approval-state field, consistent with the original record. The table's coverage of
submission/turnaround per provider (Meta direct via Business Manager, same underlying Meta review
pipeline through Twilio's or 360dialog's dashboards) was found adequate on review — no material gap
to add here beyond what's already written.

### Additional open questions (appended to the list above)

9. Should contact consent/opt-in be modeled generically across channels (extending `Contact` with a
   `consents`-style array) or WhatsApp-specifically? This affects schema design before any
   business-initiated WhatsApp send path is built.
10. Given the cross-cutting finding above, should the "per-organization integration credential store"
    be scoped and built as its own epic/decision (shared by PSP and WhatsApp, and likely future
    integrations), rather than being decided inside either provider-specific record? This is now a
    bigger open question than the WhatsApp provider pick itself.

## Sources

- [Pricing on the WhatsApp Business Platform — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [Conversation-based pricing (Deprecated) — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing/conversation-based-pricing)
- [WhatsApp Business API Pricing in 2026: Conversation Categories, Costs, and What Changed — Blueticks](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)
- [WhatsApp Business Per-Message Pricing in 2026 — Blueticks](https://blueticks.co/blog/whatsapp-business-pricing-change-2026-per-message)
- [WhatsApp Marketing Message Pricing in 2026 — Blueticks](https://blueticks.co/blog/whatsapp-business-pricing-marketing-messages-2026)
- [WhatsApp Business Pricing Categories in 2026 — Blueticks](https://blueticks.co/blog/whatsapp-business-pricing-categories-2026-utility-marketing-authentication)
- [WhatsApp Service Message Pricing Changes Explained (2026) — Wati](https://www.wati.io/en/blog/whatsapp-service-message-pricing/)
- [WhatsApp API Pricing 2026: Channels, Regions & Templates — Wati](https://www.wati.io/en/blog/whatsapp-api-pricing-guide/)
- [Register a business phone number — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration)
- [Telephone numbers in Ivory Coast — Wikipedia](https://en.wikipedia.org/wiki/Telephone_numbers_in_Ivory_Coast)
- [Telephone numbers in Morocco — Wikipedia](https://en.wikipedia.org/wiki/Telephone_numbers_in_Morocco)
- [Twilio Pricing](https://www.twilio.com/en-us/pricing)
- [Twilio Messaging Pricing](https://www.twilio.com/en-us/pricing/messaging)
- [SMS Pricing in Morocco — Twilio](https://www.twilio.com/en-us/sms/pricing/ma)
- [How to build WhatsApp Into Your SaaS — 360dialog](https://360dialog.com/blog/how-to-build-whatsapp-into-your-saas/)
- [WhatsApp Business Platform Pricing — 360dialog](https://360dialog.com/pricing)
- [WhatsApp Partner Platform & ISV Program — 360dialog](https://360dialog.com/partners)
- [WhatsApp Business API for Developers — 360dialog](https://360dialog.com/whatsapp-api)
- [WhatsApp Business API Africa 2026 Setup Guide — AfroTools](https://afrotools.com/blog/whatsapp-business-api-africa-2026/)
- [Meta Business Verification — respond.io](https://respond.io/help/whatsapp/meta-business-verification)
- [What is Meta Business verification and how to obtain it (2026) — Aurora Inbox](https://www.aurorainbox.com/en/2026/05/14/what-is-meta-business-verification/)
- [Do I Need the WhatsApp Business API? A 2026 Readiness Checklist — Blueticks](https://blueticks.co/blog/do-i-need-whatsapp-business-api)
- [Understanding Meta's Latest Updates on Template Approval — Wati Help Center](https://support.wati.io/en/articles/12320234-understanding-meta-s-latest-updates-on-template-approval)
- [WhatsApp Utility Template Approval in 2026 — devdarren.com](https://devdarren.com/blog/whatsapp-api-template-message-approval-tips)
- [Template categorization — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)
- [WhatsApp API Rate Limits: How They Work & How to Avoid Blocks — Wati](https://www.wati.io/en/blog/whatsapp-api-rate-limits/)
- [WhatsApp Messaging Limits 2026 — Chatarmin](https://chatarmin.com/en/blog/whats-app-messaging-limits)
- [Can You Use the WhatsApp API Without Meta Business Verification? (2026) — Blueticks](https://blueticks.co/blog/whatsapp-api-without-meta-verification)
- [Messaging Limits — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits)
- [WhatsApp Tech Provider Embedded Signup — Telnyx](https://developers.telnyx.com/docs/messaging/whatsapp/embedded-signup/tech-provider)
- [WhatsApp Tech Provider program integration guide — Twilio](https://www.twilio.com/docs/whatsapp/isv/tech-provider-program/integration-guide)
- [Embedded Signup — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Become a Tech Provider — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/solution-providers/get-started-for-tech-providers)
- [Onboard WhatsApp Business app users — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [How to Receive an Opt-in From Customers for WhatsApp Business — CM.com](https://www.cm.com/blog/whatsapp-opt-in/)
- [WhatsApp Business API Opt-In Rules Explained 2026 — Wetarseel AI](https://wetarseel.ai/whatsapp-business-api-opt-in-rules/)
- [Test WhatsApp messaging with the Sandbox — Twilio](https://www.twilio.com/docs/whatsapp/sandbox)
- [Get Started - WhatsApp Cloud API — Meta for Developers](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started/)
- [WhatsApp Cloud API: Complete Meta Guide for Businesses — Gurusup](https://gurusup.com/blog/whatsapp-cloud-api)
- [Best WhatsApp API providers for business in 2026 — Infobip](https://www.infobip.com/blog/best-whatsapp-api)
- [WhatsApp statistics 2026: Global usage & market overview — Infobip](https://www.infobip.com/blog/whatsapp-statistics)
- [WhatsApp Penetration in Africa: Country Statistics (2026) — Askyazi](https://www.askyazi.com/articles/whatsapp-penetration-across-africa-statistics-by-country)
- [WhatsApp Usage Across Africa: Key Insights for 2025-2026 — Askyazi](https://www.askyazi.com/useful-data-sources-for-africa/whatsapp-usage-across-africa-key-statistics-insights-for-2025)
- [Digital media in Morocco — Wikipedia](https://en.wikipedia.org/wiki/Digital_media_in_Morocco)
