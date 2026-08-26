// Mirrors apps/api/src/integrations/integrations.types.ts's IntegrationDomain/
// IntegrationAccountStatus exactly (that file is backend-only and can't be imported from the
// frontend) — kept in sync by hand since both are small, stable, rarely-changing literal unions.
export type IntegrationDomain = "payment" | "messaging";
export type IntegrationAccountStatus =
  | "pending"
  | "active"
  | "disabled"
  | "revoked"
  | "error";

/**
 * Wave 4 Stage 2 — the fixed shape both the backend controller (apps/api/src/integrations/
 * integrations.controller.ts) and the Settings → Integrations frontend page build against, so
 * neither side drifts from the other despite being built in separate isolated worktrees. Deliberately
 * secret-free at the type level, mirroring IntegrationAccountRecord's own design: there is no field
 * here that could carry a credential, so a controller returning this shape structurally cannot leak
 * one, and a frontend consuming it has nothing to accidentally render.
 */
export interface IntegrationSummary {
  id: string;
  domain: IntegrationDomain;
  provider: string;
  status: IntegrationAccountStatus;
  market: string | null;
  lastVerifiedAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
}

/**
 * Tenant-submitted payout destination for Flow B (Merchant-of-Record split settlement) — e.g.
 * Flutterwave's Create Subaccount fields (bank code, account number, business name). Kept as a
 * plain string map rather than a Flutterwave-specific shape, since this DTO is the provider-agnostic
 * boundary the frontend and the generic integrations controller both depend on; the concrete
 * required keys are documented by whichever adapter is active (see PaymentProvider.
 * createPayoutDestination's doc), not fixed here.
 */
export interface ConnectPaymentPayoutInput {
  payoutDetails: Record<string, string>;
}

/** Tenant-submitted WhatsApp Business Account details, obtained via the BSP's own onboarding
 *  flow (360dialog embedded signup) outside this app — see docs/architecture/
 *  integrations-platform.md §5 and §9 for why a fully automated Embedded Signup handshake is a
 *  further increment, not Stage 2 scope. */
export interface ConnectMessagingAccountInput {
  wabaId: string;
  phoneNumberId: string;
  displayName: string;
}

export interface TestConnectionResult {
  ok: boolean;
  message?: string;
}
