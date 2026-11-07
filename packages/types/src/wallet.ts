import type { PlanKey } from "./plan-tiers.ts";

/**
 * Le Solde KORVA (2026-10-28, "formule B"): KORVA collects its businesses' online payments on its
 * own GeniusPay account and pays each business back. Per business, a ledger of entries — a sale,
 * GeniusPay's fee on it, KORVA's commission, a withdrawal… — from which the balance is computed.
 *
 * What a business receives = sale − GeniusPay's own fee (read on each payment) − KORVA's
 * commission (its plan's rate, below) − GeniusPay's withdrawal fee, on every plan. Cash taken at
 * the counter never enters the balance: it is in the till.
 *
 * Grid validated by the user on 2026-11-07, after the fee study on real GeniusPay transactions:
 * the old Business rate (0.5 %) was below the 1 % withdrawal fee KORVA paid on its behalf, so
 * KORVA lost money on every Business sale. Every rate now leaves KORVA a margin once that fee is
 * passed on.
 */
export const PLAN_COMMISSION_BASIS_POINTS: Record<PlanKey, number> = {
  free: 300,
  starter: 200,
  pro: 150,
  business: 100,
};

/**
 * Online payment through KORVA is the business's CHOICE (2026-11-07): it may stay cash-only, with
 * no commission at all, or turn KORVA's online payment on — after accepting the terms of
 * /conditions/paiement-en-ligne. Bump the version whenever those terms change in substance:
 * every business must then accept again before taking a new online payment.
 */
export const ONLINE_PAYMENT_TERMS_VERSION = "2026-11-07";

export interface OnlinePaymentTermsAcceptance {
  version: string;
  acceptedAt: string;
  acceptedByUserId: string;
}

/** True when the business accepted the CURRENT terms. */
export function onlinePaymentTermsAccepted(
  terms: { version?: string } | null | undefined,
): boolean {
  return terms?.version === ONLINE_PAYMENT_TERMS_VERSION;
}

/**
 * The smallest amount a customer may pay ONLINE, per currency. GeniusPay's fixed 100 XOF would
 * otherwise take more than 20 % of the sale (its own floor is 200 XOF). Below it, the customer
 * pays cash or adds to the basket. Currencies not listed have no floor of KORVA's own.
 */
export const MIN_ONLINE_PAYMENT: Record<string, number> = {
  XOF: 500,
  XAF: 500,
  EUR: 1,
  USD: 1,
};

export function minimumOnlinePayment(currency: string): number {
  return MIN_ONLINE_PAYMENT[currency.toUpperCase()] ?? 0;
}

export function commissionPercentLabel(plan: PlanKey): string {
  return `${(PLAN_COMMISSION_BASIS_POINTS[plan] / 100).toLocaleString("fr-FR")} %`;
}

/**
 * GeniusPay's own prices, for ESTIMATES shown before a sale (the ledger always books what GeniusPay
 * actually reports). Source: geniuspay.ci/pricing, read 2026-11-07 — "1% + 100 XOF" of GeniusPay
 * on top of the operator's share — and checked against KORVA's real transactions: a Wave payment
 * of 610.70 XOF cost 115.28 (2.5 % + 100), a withdrawal of 495 XOF to Wave cost 4.95 (1 %).
 * Orange Money, MTN and Moov go through GeniusPay's mobile money aggregators, priced 3.5 % by the
 * operator. Update these when GeniusPay changes its page — nothing else depends on them.
 */
export const PROVIDER_PAYMENT_METHODS = ["wave", "mobile_money", "card"] as const;
export type ProviderPaymentMethod = (typeof PROVIDER_PAYMENT_METHODS)[number];
export const PROVIDER_FEE_RATES: Record<ProviderPaymentMethod, { basisPoints: number; fixed: number }> = {
  wave: { basisPoints: 250, fixed: 100 },
  mobile_money: { basisPoints: 450, fixed: 100 },
  card: { basisPoints: 600, fixed: 100 },
};
/** GeniusPay's fee on a withdrawal to mobile money ("cashout"), in basis points of the amount. */
export const PROVIDER_PAYOUT_FEE_BASIS_POINTS = 100;
/** Currency of the fixed parts above: GeniusPay settles everything in XOF. */
export const PROVIDER_FEE_CURRENCY = "XOF";

/**
 * International sales: GeniusPay charges the customer in XOF at ITS rate. Seen on every real EUR
 * payment (2026-11-02 and 2026-11-05): 1 EUR → 610.70 XOF, 10 EUR → 6 107 XOF. The legal parity is
 * 655.957 XOF, so about 6.9 % of a euro sale is lost to the exchange before any fee. No USD payment
 * has been seen yet: USD estimates are not offered until one is.
 */
export const PROVIDER_OBSERVED_XOF_RATES: Record<string, number> = { EUR: 610.7 };
export const LEGAL_XOF_PARITIES: Record<string, number> = { EUR: 655.957 };

/** The share of a sale lost to GeniusPay's exchange rate, or null when nothing is known. */
export function providerExchangeLossShare(currency: string): number | null {
  const code = currency.toUpperCase();
  if (code === "XOF" || code === "XAF") return 0;
  const observed = PROVIDER_OBSERVED_XOF_RATES[code];
  const parity = LEGAL_XOF_PARITIES[code];
  return observed && parity ? 1 - observed / parity : null;
}

export interface SaleEstimate {
  sale: number;
  providerFee: number;
  /** Lost to GeniusPay's exchange rate (0 for a sale in XOF/XAF). */
  conversion: number;
  commission: number;
  payoutFee: number;
  /** What reaches the business's mobile money number. */
  received: number;
}

/**
 * What a business receives from one online sale, every cost included — an estimate, in the sale's
 * currency. XOF/XAF and EUR are supported; any other currency returns null (its exchange rate at
 * GeniusPay is not known yet).
 */
export function estimateSale(
  amount: number,
  method: ProviderPaymentMethod,
  plan: PlanKey,
  currency = "XOF",
): SaleEstimate | null {
  const code = currency.toUpperCase();
  const local = code === "XOF" || code === "XAF";
  const observed = PROVIDER_OBSERVED_XOF_RATES[code];
  const parity = LEGAL_XOF_PARITIES[code];
  if (!local && !(observed && parity)) return null;
  const round = local ? (value: number) => Math.round(value) : (value: number) => Math.round(value * 100) / 100;
  const rate = PROVIDER_FEE_RATES[method];
  // In XOF: what GeniusPay charges the customer, then its fee on that.
  const chargedXof = local ? amount : amount * observed!;
  const feeXof = amount > 0 ? (chargedXof * rate.basisPoints) / 10_000 + rate.fixed : 0;
  const providerFee = round(local ? feeXof : feeXof / parity!);
  const conversion = local ? 0 : round(Math.max(0, amount - chargedXof / parity!));
  const commission = round((amount * PLAN_COMMISSION_BASIS_POINTS[plan]) / 10_000);
  const credited = Math.max(0, amount - providerFee - conversion - commission);
  const payoutFee = PLAN_PAYOUT_RULES[plan].payoutFeeIncluded
    ? 0
    : round((credited * PROVIDER_PAYOUT_FEE_BASIS_POINTS) / 10_000);
  return {
    sale: amount,
    providerFee,
    conversion,
    commission,
    payoutFee,
    received: round(Math.max(0, credited - payoutFee)),
  };
}

/** How each plan withdraws. Every plan can switch on automatic withdrawals. */
export const PLAN_PAYOUT_RULES: Record<
  PlanKey,
  {
    /** Withdrawals a business may ASK for per 7 days; null = as often as it likes. */
    manualPerWeek: number | null;
    /** Automatic withdrawals may run every day (else weekly). */
    dailyAutoPayout: boolean;
    /** KORVA pays GeniusPay's withdrawal fee. False on every plan since 2026-11-07 (see the
     *  commission grid above); kept so a future offer can include it again in one place. */
    payoutFeeIncluded: boolean;
  }
> = {
  free: { manualPerWeek: 1, dailyAutoPayout: false, payoutFeeIncluded: false },
  starter: { manualPerWeek: 1, dailyAutoPayout: false, payoutFeeIncluded: false },
  pro: { manualPerWeek: null, dailyAutoPayout: true, payoutFeeIncluded: false },
  business: { manualPerWeek: null, dailyAutoPayout: true, payoutFeeIncluded: false },
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
  "conversion_fee",
  "commission",
  "payout",
  "payout_fee",
  "payout_reversal",
  "refund",
  "refund_reversal",
  "subscription",
  "subscription_reversal",
  "adjustment",
] as const;
export type WalletEntryKind = (typeof WALLET_ENTRY_KINDS)[number];

export const WALLET_ENTRY_LABELS: Record<WalletEntryKind, string> = {
  sale: "Vente payée en ligne",
  provider_fee: "Frais de paiement (GeniusPay)",
  conversion_fee: "Conversion de devise (GeniusPay)",
  commission: "Commission KORVA",
  payout: "Retrait",
  payout_fee: "Frais de retrait",
  payout_reversal: "Retrait annulé — montant rendu",
  refund: "Remboursement d'un client",
  refund_reversal: "Remboursement annulé — montant rendu",
  subscription: "Formule KORVA payée depuis le solde",
  subscription_reversal: "Formule KORVA — montant rendu",
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
  /** KORVA plan invoices are paid from the balance when it covers them. */
  autoPaySubscription: boolean;
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
