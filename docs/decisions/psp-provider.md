# PSP Decision Record — Payment Service Provider Selection

## Status
Proposed — awaiting KORVA stakeholder confirmation

## Context

### What the repo actually says about target markets

This is **not** a fabricated conclusion — it is drawn from three independent internal sources, one of which is not test-related at all:

1. **`.env.example`** declares four unused placeholders: `STRIPE_SECRET_KEY`, `CINETPAY_API_KEY`, `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY`. No code currently reads them — `apps/api/src/finance/payments/providers/` contains only `payment-provider.interface.ts` and `manual-payment.provider.ts` (`ManualPaymentProvider`, a manual cash/bank-transfer stub, `name = 'manual'`).
2. **`docs/architecture.md`** (line ~54) states explicitly, in a table of "abstractions with planned providers":
   `| PaymentProvider | Stripe, CinetPay, Paystack, Flutterwave |`
   **`docs/IMPLEMENTATION_PLAN.md`** (line 147) says the abstraction pattern "évite le couplage et permet le support multi-région (Stripe/CinetPay/Paystack/Flutterwave)" — i.e., the four candidates are an explicit, documented multi-region plan, not an accident.
3. **`apps/web/src/app/onboarding/page.tsx`** — the real organization-creation UI a customer fills in — hardcodes:
   ```
   COUNTRIES = FR, CI (Côte d'Ivoire), SN (Sénégal), MA (Maroc), BE, CA
   CURRENCIES = EUR, XOF, MAD, USD, CAD
   ```
   This is a **product-facing UI signal**, independent of test fixtures — a real prospective customer choosing "Côte d'Ivoire" or "Maroc" as their country and "XOF"/"MAD" as their currency during onboarding is the strongest evidence in the repo of intended target markets.

The e2e test fixtures (`apps/api/test/*.e2e-spec.ts`) default every organization to `country: 'FR'` — as the task brief suspected, this is confirmed to be **test convenience only** (every single fixture across ~20 files uses the identical hardcoded `'FR'`, `'EUR'` regardless of what the test is about), not a market signal. The onboarding dropdown is the real signal, and it points at a francophone, multi-region footprint (France + Belgium + Canada in the "Western/EUR" cluster; Côte d'Ivoire + Sénégal + Maroc in the "African/local-currency" cluster) — not a Stripe-first, card-first, single-market product.

The entire `README.md` is written in French ("Business Operating System SaaS multi-tenant pour PME, indépendants et entreprises de services") — consistent with, but not additional independent proof beyond, the above.

**Conclusion on market signal strength**: strong and multi-sourced (product code + docs + architecture decision, not just tests) that Morocco and Côte d'Ivoire (plus Sénégal) are genuine intended markets alongside France/Belgium/Canada. This is *not* proof that Morocco/Côte d'Ivoire are the *primary* or *first-launch* market — the dropdown lists France first and defaults to `FR`/`EUR` — but it is solid proof they are in scope, which is what this research round was asked to evaluate against.

### The architectural fork question (see dedicated section below)

KORVA is multi-tenant: each organization (tenant) is itself a merchant collecting money from *its own* end customers (via storefront checkout, invoices, bookings). The `PaymentProvider` interface as currently written (`createPayment`/`verifyPayment`/`getPaymentStatus`/`refundPayment`, injected once via a single `PAYMENT_PROVIDER` token) implicitly assumes **one provider account for the whole platform** — there is no per-organization provider credential concept anywhere in `identity`/`organizations`/`finance`. Before any real integration is built, KORVA must decide whether it is:
- **(a) Platform/merchant-of-record model** — KORVA holds one provider account, collects on behalf of tenants, and pays tenants out via split/subaccount features, or
- **(b) Tenant-owns-account model** — each tenant connects their own provider account/API keys, and KORVA's `PaymentProvider` implementation is instantiated per-tenant.

This is a genuine fork with different providers ranking differently depending on the answer (see dedicated section below).

## Markets evaluated
Morocco (MA), Côte d'Ivoire (CI) — as explicitly assigned this round — plus Sénégal (SN) noted where evidence surfaced it (it appears in the same onboarding dropdown and several West-African providers cover it as part of the same regional footprint as Côte d'Ivoire; not separately deep-researched).

## Providers evaluated
- **Stripe**
- **CinetPay**
- **Paystack** (Stripe-owned since 2020)
- **Flutterwave**
- **PayDunya** (West-Africa-specific aggregator, surfaced as regionally relevant)
- **HUB2** (Francophone-Africa-specific aggregator/infrastructure, surfaced as regionally relevant)
- **CMI / Maroc Telecommerce** (Morocco's domestic card rail — CMI acquired Maroc Telecommerce in 2016; they are now the same entity, listed together)
- **ChariBaaS / Chari Pay** (Morocco-licensed Bank Al-Maghrib fintech, surfaced specifically as the closest thing Morocco has to a Stripe-equivalent, including Connect-style marketplace splits)
- **Wave Business** (mobile-money-native, dominant in Côte d'Ivoire, surfaced as a mobile-money-specific option)

## Comparison

| Criterion | Stripe | CinetPay | Paystack | Flutterwave | PayDunya | HUB2 | CMI / Maroc Telecommerce | ChariBaaS (Chari Pay) | Wave Business |
|---|---|---|---|---|---|---|---|---|---|
| **Operates in Morocco** | **No.** Not on Stripe's supported-country list; no MAD settlement; Morocco's Office des Changes forex controls block it directly ([baas.ma](https://www.baas.ma/en/blog/stripe-maroc-2026-alternative)) | No evidence found of Morocco coverage; focus is West/Central Africa ([search summary](https://cinetpay.com/products/payments)) | No — not an officially supported market ([storeleads.app](https://storeleads.app/reports/technology/Paystack/country/MA)) | Not currently — regional manager cited Morocco as a "near future" target, not live ([theafricareport.com](https://www.theafricareport.com/284961/flutterwave-plans-north-africa-middle-east-expansion-after-securing-egyptian-licenses/)) | No | No | **Yes — domestic incumbent**, "most widely used gateway by Moroccan online stores" ([azulweb.ma](https://azulweb.ma/en/accept-online-payments-morocco/)) | **Yes — Morocco-native**, licensed by Bank Al-Maghrib under law 103-12 ([baas.ma](https://www.baas.ma/en/blog/passerelle-paiement-maroc-guide)) | No |
| **Operates in Côte d'Ivoire** | Indirect only, via the Paystack acquisition's "extended network" — not core Stripe | **Yes**, strong coverage, part of its 9-country West/Central Africa footprint | **Yes**, official beta→GA market since 2025 ([paystack.com/blog](https://paystack.com/blog/company-news/civ-rwanda-egypt-beta)) | **Yes**, listed among supported countries with XOF ([flutterwave.com onboarding page](https://flutterwave.com/us/support/onboarding/onboarding-requirements-for-using-flutterwave-in-ivory-coast)) | **Yes**, core market (with Sénégal, Bénin, Togo, Burkina Faso, Mali) | **Yes**, launched in CI in 2019, core market | No (Morocco-only) | No (Morocco-only) | **Yes**, live entity since 2023-24, separate legal entity per country |
| **Card support (Visa/Mastercard)** | Full, best-in-class | Yes, via aggregated local acquiring | Yes, local + international cards (different fee tiers) | Yes | Limited/aggregated | Aggregated via partners | **Yes — this is CMI's core business** (interbank card processor) | Yes, "local bank cards" | No (mobile-money only) |
| **Mobile Money (Orange/MTN/Moov/Wave)** | No | **Yes**, core product (CI, Mali, Sénégal, Cameroon, +) | **Yes** — Orange Money, MTN MoMo, Moov Money in CI ([mctaba.com](https://www.mctaba.com/learn/paystack/payment-methods-available-on-paystack-in-cote-d-ivoire)) | **Yes** — MTN, Orange, Wave in CI; francophone mobile-money charge method documented ([developer.flutterwave.com](https://developer.flutterwave.com/v3.0/reference/charge-via-francophone-mobile-money)) | **Yes**, core product | **Yes** — Wave, Orange, MTN, Moov, Free, T-Money partners | Not primary (Orange Money/Inwi Money/WafaCash noted as "complementary" in Morocco, low integration priority) | Local Moroccan wallets + "Maroc Pay" QR, per source | **Yes — this is Wave's whole product**, lowest fee in market (~1% vs 1.5–3% telco fees) |
| **Published fees** | Public, ~2.9%+30¢ (not CI/MA relevant since unavailable there) | 2.5–3.5% cited, varies by country/method, full schedule requires portal login ([search summary](https://cinetpay.com/pricing)) | **3.2% local card / 3.8% international card in CI**, published pricing page ([paystack.com/ci/pricing](https://paystack.com/ci/pricing)); payouts free | Not fully published in search results; industry sources cite similar 2.5–3.5% range, requires developer portal to confirm | 1.5–2.2% depending on volume, published | Not publicly listed — enterprise/sales-negotiated | 1.5–2.5% + 500–1500 MAD install + 0–200 MAD/mo, via partner bank ([azulweb.ma](https://azulweb.ma/en/accept-online-payments-morocco/)) | 1.5–3.5% for local cards cited, zero setup fees | ~1% commission, cited as cheapest in CI market |
| **API / webhooks / signature verification** | Gold standard, extensive docs | REST API with docs at docs.cinetpay.com; signed init/callback flow | Full REST docs, `x-paystack-signature` header, timing-safe verification helpers in community SDKs | Full REST v3 docs, webhook + signature verification | Simple REST API, French-first docs | High-reliability API (~100% success rate claimed vs 40-50% for "local aggregators" per HUB2's own marketing — **treat as a vendor claim, not independently verified**) | Traditional/limited REST, some integrations are hosted-redirect-only rather than a modern JSON API | **"Modern REST APIs" with interactive docs**, explicitly built to mirror Stripe's API shape (Payment Intents, Customers, Subscriptions, Connect, signed webhooks) | API + webhook for payment confirmation, documented via third-party integration guides more than first-party docs in search results |
| **Refunds** | Full API-driven | API-driven (per interface docs) | API-driven | API-driven | Not confirmed — likely manual/support-mediated given smaller platform | Not confirmed | Manual, bank-mediated (traditional card-acquirer refund flow) | API-driven ("refunds and disputes" explicitly listed) | Not confirmed, mobile money refunds are frequently manual/telco-mediated in the region |
| **Payouts / marketplace split payments** | Stripe Connect — industry-leading | "Mass Payout" product exists (bulk payouts), country/volume-dependent fees, negotiable | **Split Payments**, but only across **two accounts** (platform + one subaccount) — a real limitation for multi-tenant fan-out beyond a single split | **Split Payments with Sub-accounts**, percentage or fixed, real-time, multi-recipient (no "two account" cap found) | Not confirmed | Not a payments/settlement splitter per se — infrastructure/interoperability layer | Not designed for this; traditional bilateral merchant-bank relationship | **Explicit "Connect" equivalent** — "payment splitting and settlement to sellers," designed for platforms/marketplaces | Not designed for this — single merchant wallet model |
| **Merchant onboarding** | Self-serve, but **not available at all** for MA/CI-domiciled entities without a foreign (US/UK) legal entity workaround | Online signup + document upload (business registration + ID scan) to `activations@cinetpay.com`, no bank visit required | Self-serve online signup in CI (GA market) | Self-serve online signup + documented "onboarding requirements" for Ivory Coast | Self-serve, French-first | Enterprise/partnership-led, not self-serve for a small SaaS tenant | **Slow — 1–3 weeks**, requires a partner bank relationship (Attijariwafa, BMCE, CIH, etc.), business registration (RC) or auto-entrepreneur status | Fast, "zero setup fees," simplified KYC/KYB, self-serve-oriented | Requires an in-person Abidjan visit with proof of activity — not fully self-serve |
| **Compliance (local)** | N/A (unavailable) | BCEAO-regulated (West African regional central bank) — **see reliability section below**, obtained BCEAO approval | Regulated per-market | Regulated per-market, pursuing Egypt/North Africa licenses | BCEAO-regulated | BCEAO-regulated | Bank Al-Maghrib-regulated, 3D Secure mandatory, CNDP data-privacy compliance required | **Licensed by Bank Al-Maghrib under law 103-12** — explicit banking regulator license, not just a processor agreement | BCEAO-regulated, separate legal entity per country |
| **Business account approval realism (MA)** | Impossible without foreign entity | N/A (doesn't operate there) | N/A | N/A (not live yet) | N/A | N/A | Yes, if merchant has real Moroccan business registration + bank relationship | Yes, explicitly designed for this | N/A |
| **Business account approval realism (CI)** | Only via Paystack's separate CI product | Yes | Yes | Yes | Yes | Enterprise-scale only | N/A | N/A | Yes, in-person |
| **Currency settlement (MAD/XOF)** | N/A | XOF only (no MAD) | XOF only (no MAD) | XOF only (no MAD, until/unless MA launches) | XOF only | XOF-region only | MAD, direct | MAD, direct, "no tax complexity" vs. workaround routes | XOF, direct |
| **Sandbox/test environment** | Yes, excellent | Yes | Yes | Yes | Not confirmed | Not confirmed (enterprise-led) | Yes, per developer sources, though documentation is thinner | Yes, "interactive documentation" + test environment | Not confirmed |
| **Node.js/TypeScript integration** | Official, best-in-class TS SDK | Community/plugin-level integrations (WooCommerce, Shopify), no first-party mention of an official Node SDK found | Multiple community TS-first SDKs (no single official first-party Node SDK found in search — `paystack-node`, `paystack-sdk`, `@enviabledev/paystack-api`), official REST docs are solid regardless | **Official `flutterwave-node-v3`** on npm (Node ≥18, active, TS typings) — best first-party Node story of the African-native options found | Not confirmed, appears REST-only with plugin coverage | Not confirmed | Community-built plugins (Django, Drupal) only — no first-party Node/TS SDK found | SDKs "across major programming languages" claimed, not independently verified for Node specifically | Not confirmed, mostly documented via third-party integration guides |
| **Reliability / reputation signal** | Excellent, industry-leading uptime reputation | **Major red flag**: coordinated cyber-fraud incident (Sept 2025) across CI/Togo/Burkina Faso led to a **$1.2M+ settlement backlog owed to partners** (e.g., DPay), unmet repayment commitments as of Jan 2026, and no public response Dec 2025–Jan 2026 ([TechCabal](https://techcabal.com/2026/02/01/cinetpay-cyberattack/)) — **this is current as of this research (Aug 2026)** | No comparable incident surfaced in this research | No comparable incident surfaced; HUB2's marketing claims "40–50% success rate" for unnamed "local aggregators" as a competitive dig — read skeptically, no independent source | No comparable incident surfaced | No comparable incident surfaced; claims ~100% API success rate (vendor-sourced, unverified) | Established national payment-card monopoly-adjacent institution (bank-owned), stable but bureaucratic | New/smaller, no adverse signal found, but also no long incident-free track record found either | Fast-growing, dominant CI mobile-money brand, no adverse signal found |

## Architectural consideration: merchant-of-record model

This is the single most consequential open question, and it changes the ranking:

**If KORVA is the merchant of record (platform model, tenants are "sub-merchants")**: KORVA needs a provider with genuine split-payment/subaccount/Connect-equivalent functionality that actually works for arbitrary numbers of tenants, not just "one platform + one subaccount." On the evidence gathered:
- **Flutterwave's split payments** appear to support multiple named subaccounts per transaction (best fit found for CI).
- **Paystack's split payments are capped at two accounts** per the documentation found — this is a real functional limitation for a platform intending to fan out to many tenants unless each tenant transaction is handled as its own isolated split (which may work operationally, but is worth stakeholders confirming against current Paystack docs before committing).
- **ChariBaaS/Chari Pay explicitly markets a Connect-equivalent** ("payment splitting, and settlement to sellers") for Morocco — this is the only Morocco-side option found with native marketplace support; CMI/Maroc Telecommerce show no such capability in the traditional bank-acquirer model.
- CinetPay's "Mass Payout" product could plausibly be adapted to pay out tenants in bulk after KORVA collects centrally, but this looks more like a batch-payout tool than a per-transaction split primitive — needs direct confirmation with CinetPay before relying on it architecturally.

**If each tenant owns its own provider account (tenant-as-merchant model)**: KORVA's `PaymentProvider` interface would need to become per-tenant (credentials stored per organization, provider instantiated per request/tenant rather than injected once via a single global `PAYMENT_PROVIDER` token as it is today) — a non-trivial change to the current DI wiring in `apps/api/src/finance/payments/`. In this model, provider choice is less centralized: each tenant might reasonably pick CMI (Morocco) or Wave/Paystack/CinetPay (CI) directly, and KORVA's job shrinks to "support multiple provider adapters cleanly," which the existing `PaymentProvider` interface already does well in spirit — this is likely the *lower-risk* path given the interface as currently designed, but it pushes onboarding friction (CMI's 1–3 week bank-mediated approval; Wave's in-person Abidjan visit) onto every individual KORVA tenant, which may be an unacceptable UX regression for a self-serve SaaS.

**Neither model is confirmed anywhere in the codebase.** `docs/architecture.md`'s "Stripe, CinetPay, Paystack, Flutterwave" table gives no hint either way. This is the top blocking question for stakeholders (see below) — it is not something this research can resolve from repo evidence alone, and it materially changes which provider is "best."

## Recommendation

**No single provider clearly wins across both Morocco and Côte d'Ivoire simultaneously** — the evidence does not support a false confident single-provider answer, because no candidate researched actually operates in both markets:

- **Stripe is not viable for either market** as a primary rail: not available for Morocco-domiciled merchants at all (Office des Changes/no Bank Al-Maghrib license), and only reaches Côte d'Ivoire indirectly through its acquired Paystack subsidiary rather than as a native Stripe product. Given the strong internal evidence that KORVA's real target is francophone Africa (not a card-first Western market), continuing to carry `STRIPE_SECRET_KEY` in `.env.example` as if it were a peer candidate for these two markets is not supported by this research.
- **For Côte d'Ivoire specifically**, the evidence points to **Paystack or Flutterwave** as the strongest general-purpose candidates: both have real, live, self-serve CI operations, published fees, mobile money (Orange/MTN/Moov, +Wave for Flutterwave), decent API/SDK stories, and split-payment features. Flutterwave's split payments appear more flexible (multi-subaccount) than Paystack's (two-account cap), which matters if KORVA becomes merchant-of-record. **CinetPay must be treated with real caution right now** despite strong regional coverage and mobile-money depth — the Sept 2025 cyberattack and ongoing (as of Jan 2026, i.e. recent relative to this research date) multi-million-dollar settlement backlog with partners is a live reliability red flag, not historical trivia, and should not be the default choice while that situation is unresolved.
- **For Morocco specifically**, there is no cross-market unification possible: none of Stripe/CinetPay/Paystack/Flutterwave operate there at all. The realistic candidates are **CMI/Maroc Telecommerce** (the domestic incumbent, slower/bank-mediated onboarding, limited REST/marketplace capability, but the standard every Moroccan online store uses) or **ChariBaaS/Chari Pay** (the only Morocco-side option with a modern Stripe-shaped API and genuine marketplace/split-payment support, licensed by Bank Al-Maghrib) — ChariBaaS looks like the stronger technical and architectural fit *if* KORVA becomes merchant-of-record, since it is the only Morocco-capable provider found with Connect-equivalent splitting; CMI is the safer choice if KORVA instead pushes each tenant to hold their own domestic merchant account, since it is the incumbent every Moroccan bank already integrates with.

**Given all of the above, the honest recommendation is: this is not a single-pick decision, and forcing one would be irresponsible.** Two things need to happen before implementation:
1. **The merchant-of-record question must be answered first** — it changes whether ChariBaaS/Flutterwave (both good split-payment stories) or CMI/tenant-direct-integration (simpler, no splitting needed) is the right shape.
2. **KORVA likely needs *at least two* provider adapters even for just these two markets** (one CI-capable, one MA-capable, since no single candidate covers both) — which is actually consistent with the existing `PaymentProvider` interface design (`apps/api/src/finance/payments/providers/payment-provider.interface.ts`) already being provider-agnostic and swappable. That part of the architecture does not need to change; only the "one global token" wiring might, depending on question 1.

If forced to name a starting pair pending stakeholder confirmation: **Flutterwave for Côte d'Ivoire** (best split-payment flexibility + official Node SDK + live self-serve onboarding) and **ChariBaaS for Morocco** (only Morocco-capable option with a modern API and marketplace-splitting support) — with CMI kept as the fallback/tenant-direct option for Morocco if the tenant-owns-account model is chosen instead. This is a reasoned starting point for a technical spike, **not a final production decision**.

## Open questions requiring stakeholder confirmation

1. **Merchant-of-record model**: will KORVA act as merchant of record (platform collects, splits/pays out to tenants) or will each tenant hold and connect its own provider account? This single answer materially changes the recommended provider(s) and the `PaymentProvider` DI wiring.
2. **Is Morocco or Côte d'Ivoire the priority launch market**, or are both simultaneous? Since no single provider covers both, sequencing affects which integration gets built first.
3. **Confirm KORVA is not planning to prioritize card-heavy Western/EUR markets (France/Belgium/Canada) first** — the onboarding dropdown lists France first and defaults to `FR`/`EUR`, so it's not certain Morocco/CI are the near-term priority versus the European cluster also present in the same dropdown.
4. **Is `STRIPE_SECRET_KEY` still needed in `.env.example`** for the France/Belgium/Canada cluster specifically (where Stripe *would* work), even if it's dropped as a candidate for Morocco/Côte d'Ivoire? This research only evaluated MA/CI per this round's scope — Stripe may still be entirely correct for the EUR-market cluster, which was out of scope here.
5. **Risk tolerance for CinetPay given its live settlement backlog** (as of this research, Aug 2026) — is this a hard blocker, or is KORVA comfortable revisiting CinetPay once/if the backlog is resolved?
6. **Confirm Paystack's split-payment two-account limit** directly against current Paystack docs/support before any implementation decision — this research could not verify whether that cap has since been lifted or whether a workaround (e.g., chained/sequential splits) is officially supported for multi-tenant fan-out.
7. **Verify CMI/ChariBaaS/PayDunya/HUB2 fee schedules directly with each vendor** — several fee figures in this record are third-party-cited (blog posts, comparison sites) rather than pulled from each provider's own current pricing page, and pricing changes frequently in this market.
8. **Decide whether Sénégal** (present in the same onboarding dropdown, and covered by the same regional providers as Côte d'Ivoire — CinetPay, Paystack-adjacent, PayDunya, HUB2, Wave) **should be folded into the same integration work**, since it wasn't in this round's explicit scope but shares infrastructure with the CI decision.
9. No code should be written based on this document alone — this is a research/decision-support artifact, not an implementation spec. A follow-up technical spike (test API keys, actual sandbox transactions in each candidate) should precede any real `PaymentProvider` implementation.

## Sources

- [Stripe in Morocco in 2026: why it doesn't work and the alternative — ChariBaaS](https://www.baas.ma/en/blog/stripe-maroc-2026-alternative)
- [Payment Gateway in Morocco: Complete Guide 2026 — baas.ma](https://www.baas.ma/en/blog/passerelle-paiement-maroc-guide)
- [Accept Online Payments in Morocco 2026: CMI, PayZone, Mobile Money — azulweb.ma](https://azulweb.ma/en/accept-online-payments-morocco/)
- [CinetPay faces $1M settlement backlog months after reported cyberattack — TechCabal](https://techcabal.com/2026/02/01/cinetpay-cyberattack/)
- [CinetPay — All Business Africa](https://allbusiness.africa/business/cinetpay)
- [CinetPay — payments product page](https://cinetpay.com/products/payments)
- [CinetPay — Mass Payout product page](https://cinetpay.com/products/mass-payout)
- [CinetPay Documentation — Merchant Service](https://docs.cinetpay.com/api/1.0-en/BO/service)
- [CinetPay Documentation — Initiating a payment](https://docs.cinetpay.com/api/1.0-en/checkout/initialisation)
- [Paystack — Countries](https://paystack.com/countries)
- [Paystack — Côte d'Ivoire pricing](https://paystack.com/ci/pricing)
- [Paystack Blog — Join the private beta in Côte d'Ivoire, Egypt, and Rwanda](https://paystack.com/blog/company-news/civ-rwanda-egypt-beta)
- [Paystack Blog — Virtual Terminal expansion (CI, Ghana, Kenya, South Africa)](https://paystack.com/blog/product/virtual-terminal-expansion)
- [Payment Methods on Paystack in Cote d'Ivoire (2026) — mctaba.com](https://www.mctaba.com/learn/paystack/payment-methods-available-on-paystack-in-cote-d-ivoire)
- [Paystack Developer Documentation — Payment Channels](https://paystack.com/docs/payments/payment-channels/)
- [Paystack split-payments documentation (GitHub)](https://github.com/PaystackHQ/documentation/blob/master/receiving-payments/split-payments.md)
- [Ecommerce stores using Paystack in Morocco — storeleads.app](https://storeleads.app/reports/technology/Paystack/country/MA)
- [Flutterwave plans North Africa, Middle East expansion after securing Egyptian licenses — The Africa Report](https://www.theafricareport.com/284961/flutterwave-plans-north-africa-middle-east-expansion-after-securing-egyptian-licenses/)
- [Flutterwave — Onboarding requirements for Ivory Coast](https://flutterwave.com/us/support/onboarding/onboarding-requirements-for-using-flutterwave-in-ivory-coast)
- [Flutterwave API Documentation — Francophone mobile money charge](https://developer.flutterwave.com/v3.0/reference/charge-via-francophone-mobile-money)
- [Flutterwave — Split Payments with Sub-accounts](https://flutterwave.com/eg/support/payments/split-payments-with-sub-accounts)
- [Flutterwave Developer Docs — Split Payments](https://developer.flutterwave.com/v3.0/docs/split-payments)
- [flutterwave-node-v3 — npm](https://www.npmjs.com/package/flutterwave-node-v3)
- [Flutterwave Supported Countries & Alternatives (Jan 2026) — supportedcountries.com](https://supportedcountries.com/flutterwave/)
- [Partenaires de PayDunya](https://paydunya.com/partners)
- [Mobile money en backend : Wave, Orange Money, PayDunya, CinetPay — sentur.net](https://sentur.net/mobile-money-backend-afrique-ouest/)
- [HUB2 Pay-In API](https://www.hub2.io/hub2-pay-in-api/)
- [HUB2 — Best in Class Digital Transaction Platform In Africa](https://join.hub2.io/)
- [HUB2 founders — "a Stripe for francophone Africa" — TechCrunch](https://techcrunch.com/2024/12/02/hub2-a-stripe-for-francophone-africa-banks-8m)
- [Wave Business API : intégration site e-commerce 2026 — Kolonell](https://kolonell.com/fr/blog/wave-business-api-integration-site-2026)
- [Intégrer Wave en Côte d'Ivoire: guide marchand 2026 — Kolonell](https://kolonell.com/fr/blog/wave-cote-ivoire-integration-marchand-abidjan-2026)
- [Maroc Telecommerce | CMI](https://www.cmi.co.ma/fr/maroc-telecommerce)
- [Django Maroc Telecommerce integration (GitHub reference implementation)](https://github.com/gregtap/django-maroc-telecommerce)
- [Paystack Node.js community SDK (alexasomba/paystack-node)](https://github.com/alexasomba/paystack-node)
- [Paystack Developer Documentation — Webhooks](https://paystack.com/docs/payments/webhooks/)

## Internal evidence (this repository, for reference)

- `.env.example` — `STRIPE_SECRET_KEY`, `CINETPAY_API_KEY`, `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY` (all unused today)
- `apps/api/src/finance/payments/providers/payment-provider.interface.ts` — the `PaymentProvider` interface all future adapters must implement
- `apps/api/src/finance/payments/providers/manual-payment.provider.ts` — current (only) implementation
- `apps/web/src/app/onboarding/page.tsx` — `COUNTRIES`/`CURRENCIES` constants, the strongest product-facing market signal found
- `docs/architecture.md` — "Abstractions de fournisseurs" table naming Stripe/CinetPay/Paystack/Flutterwave as planned
- `docs/IMPLEMENTATION_PLAN.md` — Phase 4 notes confirming the `PaymentProvider` abstraction is deliberately provider-agnostic and multi-region-intended, with no real online provider wired yet
