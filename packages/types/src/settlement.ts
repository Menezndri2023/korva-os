export const SETTLEMENT_STATUSES = ["pending", "settled", "failed"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

/**
 * Split-settlement record for Flow B (KORVA is Merchant of Record — see
 * docs/architecture/integrations-platform.md §1 decision #2 and §4 "Split settlement"): KORVA
 * collects the full customer payment, computes its own commission, and owes the tenant the
 * remainder. This is the Stage 1 domain shape only — nothing here is wired into the real
 * payment-completion flow yet (that's Stage 2, once a real PSP adapter exists).
 *
 * All money fields are integer minor units (e.g. cents), never floating point, matching this
 * repo's Payment/Invoice money convention.
 */
export interface Settlement {
  id: string;
  organizationId: string;
  /** Source reference this settlement was computed from — a Payment id. */
  paymentId: string;
  /** Full amount KORVA collected from the customer, in integer minor units. */
  grossAmount: number;
  currency: string;
  /**
   * The commission rate actually applied when this settlement was computed, in basis points
   * (1/100th of a percent — e.g. 1000 = 10.00%). Persisted per-record (not just derived from
   * current config) so a historical settlement's split remains explainable even if the
   * commission rate configuration changes later. Stage-1 scaffolding: no real business rate has
   * been decided yet — see SettlementService for where this is configured.
   */
  commissionRateBasisPoints: number;
  /** KORVA's retained amount, integer minor units. */
  commissionAmount: number;
  /** Amount owed to the tenant, integer minor units. Always commissionAmount + tenantAmount === grossAmount. */
  tenantAmount: number;
  status: SettlementStatus;
  settledAt?: string;
  createdAt: string;
  updatedAt: string;
}
