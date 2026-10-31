import type { PlanKey } from "./plan-tiers.ts";

/**
 * Le Solde KORVA (2026-10-28, "formule B"): KORVA collects its businesses' online payments on its
 * own GeniusPay account and pays each business back. Per business, a ledger of entries — a sale,
 * GeniusPay's fee on it, KORVA's commission, a withdrawal… — from which the balance is computed.
 *
 * What a business receives = sale − GeniusPay's own fee (read on each payment) − KORVA's
 * commission (its plan's rate, below). GeniusPay's withdrawal fee is passed on too, except on
 * Business. Cash taken at the counter never enters the balance: it is in the till.
 */
export const PLAN_COMMISSION_BASIS_POINTS: Record<PlanKey, number> = {
  free: 300,
  starter: 150,
  pro: 100,
  business: 50,
};

export function commissionPercentLabel(plan: PlanKey): string {
  return `${(PLAN_COMMISSION_BASIS_POINTS[plan] / 100).toLocaleString("fr-FR")} %`;
}

/** How each plan withdraws. Every plan can switch on automatic withdrawals. */
export const PLAN_PAYOUT_RULES: Record<
  PlanKey,
  {
    /** Withdrawals a business may ASK for per 7 days; null = as often as it likes. */
    manualPerWeek: number | null;
    /** Automatic withdrawals may run every day (else weekly). */
    dailyAutoPayout: boolean;
    /** KORVA pays GeniusPay's withdrawal fee. */
    payoutFeeIncluded: boolean;
  }
> = {
  free: { manualPerWeek: 1, dailyAutoPayout: false, payoutFeeIncluded: false },
  starter: { manualPerWeek: 1, dailyAutoPayout: false, payoutFeeIncluded: false },
  pro: { manualPerWeek: null, dailyAutoPayout: true, payoutFeeIncluded: false },
  business: { manualPerWeek: null, dailyAutoPayout: true, payoutFeeIncluded: true },
};

/** Where a withdrawal can go — GeniusPay's payout destinations ("Wave, Orange Money, MTN, Moov"). */
export const PAYOUT_PROVIDERS = ["wave", "orange_money", "mtn_money", "moov_money"] as const;
export type PayoutProvider = (typeof PAYOUT_PROVIDERS)[number];
export const PAYOUT_PROVIDER_LABELS: Record<PayoutProvider, string> = {
  wave: "Wave",
  orange_money: "Orange Money",
  mtn_money: "MTN Mobile Money",
  moov_money: "Moov Money",
};

export const PAYOUT_FREQUENCIES = ["weekly", "daily"] as const;
export type PayoutFrequency = (typeof PAYOUT_FREQUENCIES)[number];

/** The smallest withdrawal, in the business's currency's whole units (XOF). */
export const MIN_PAYOUT_AMOUNT = 1000;

export const WALLET_ENTRY_KINDS = [
  "sale",
  "provider_fee",
  "commission",
  "payout",
  "payout_fee",
  "payout_reversal",
  "adjustment",
] as const;
export type WalletEntryKind = (typeof WALLET_ENTRY_KINDS)[number];

export const WALLET_ENTRY_LABELS: Record<WalletEntryKind, string> = {
  sale: "Vente payée en ligne",
  provider_fee: "Frais de paiement (GeniusPay)",
  commission: "Commission KORVA",
  payout: "Retrait",
  payout_fee: "Frais de retrait",
  payout_reversal: "Retrait annulé — montant rendu",
  adjustment: "Correction par KORVA",
};

export const PAYOUT_STATUSES = ["requested", "processing", "completed", "failed", "rejected"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  requested: "Demandé",
  processing: "En cours d'envoi",
  completed: "Versé",
  failed: "Échoué — montant rendu",
  rejected: "Refusé — montant rendu",
};

export interface WalletEntry {
  id: string;
  kind: WalletEntryKind;
  amount: number;
  currency: string;
  availableAt: string;
  paymentId?: string;
  payoutId?: string;
  note?: string;
  createdAt: string;
}

export interface PayoutDestination {
  provider: PayoutProvider;
  /** International format, e.g. "+225 07 07 07 07 07". */
  account: string;
  holderName: string;
}

export interface Payout {
  id: string;
  organizationId: string;
  amount: number;
  fee?: number;
  currency: string;
  status: PayoutStatus;
  trigger: "manual" | "auto";
  destination: PayoutDestination;
  providerReference?: string;
  failureReason?: string;
  createdAt: string;
  completedAt?: string;
}

/** GET /wallet — what the business sees on its "Solde" page. */
export interface WalletSummary {
  currency: string;
  /** Can be withdrawn now. */
  available: number;
  /** Paid by customers, released after the safety delay. */
  pending: number;
  plan: PlanKey;
  commissionBasisPoints: number;
  holdDays: number;
  destination: PayoutDestination | null;
  /** A destination change waiting for its e-mailed code. */
  pendingDestination: { provider: PayoutProvider; account: string } | null;
  autoPayout: { enabled: boolean; frequency: PayoutFrequency; minimum: number };
  openPayout: Payout | null;
  /** Manual withdrawals still allowed in the current 7 days; null = unlimited. */
  manualPayoutsLeftThisWeek: number | null;
}

/** GET /platform/wallets/overview — the administration's view of the money KORVA holds. */
export interface PlatformWalletOverview {
  currency: string;
  heldAvailable: number;
  heldPending: number;
  commissionThisMonth: number;
  payoutsToApprove: number;
  payoutsProcessing: number;
  approvalMode: "manual" | "auto";
}
