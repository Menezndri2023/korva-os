/**
 * What the payment provider kept on one sale, in the SALE's currency — the amounts the Solde KORVA
 * books against the business.
 *
 * Why this exists: GeniusPay settles in XOF whatever the order's currency. A real 1 EUR order
 * (2026-11-02) came back as `amount 610.7, currency XOF, fees 115.28`: booking that fee as-is wrote
 * −115.28 EUR on a 1 EUR sale. Two separate costs hide in that answer:
 *
 *   - the fee itself, 115.28 XOF;
 *   - the exchange rate: GeniusPay charged 610.70 XOF for 1 EUR where the legal parity is
 *     655.957 XOF, so 6.9 % of the sale never reached KORVA's account at all.
 *
 * Both are taken off the business's sale, each on its own ledger line, so that what the business
 * is credited is exactly what KORVA received — never more, or KORVA would pay the difference out
 * of its own pocket at withdrawal time.
 */

/** Fixed by treaty (CFA franc zones): 1 EUR = 655.957 XOF = 655.957 XAF. Never a market rate. */
const FIXED_PARITIES: Record<string, number> = {
  'EUR>XOF': 655.957,
  'EUR>XAF': 655.957,
};

export interface ProviderSettlement {
  providerFee?: number;
  providerAmount?: number;
  providerCurrency?: string;
}

export interface SaleCosts {
  /** The provider's fee, in the sale's currency; undefined when the provider did not say. */
  fee?: number;
  /** Lost to the provider's exchange rate, in the sale's currency (0 when nothing was converted). */
  conversion: number;
  /** Shown on the ledger line, so the business can check the numbers against GeniusPay's. */
  detail?: {
    providerAmount: number;
    providerCurrency: string;
    providerFee?: number;
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function saleCostsInSaleCurrency(
  sale: { amount: number; currency: string },
  settlement: ProviderSettlement,
): SaleCosts {
  const { providerFee, providerAmount, providerCurrency } = settlement;
  const currency = sale.currency.toUpperCase();
  if (
    !providerCurrency ||
    providerCurrency === currency ||
    !providerAmount ||
    providerAmount <= 0
  ) {
    return { fee: providerFee, conversion: 0 };
  }

  const detail = { providerAmount, providerCurrency, providerFee };
  const parity = FIXED_PARITIES[`${currency}>${providerCurrency}`];
  if (parity) {
    // What the provider charged is worth providerAmount / parity in the sale's currency: the rest
    // of the sale was lost to its exchange rate. A rate in the business's favour credits nothing
    // extra — KORVA never pays out money it did not receive, and never invents a gain.
    return {
      fee: providerFee === undefined ? undefined : round2(providerFee / parity),
      conversion: Math.max(0, round2(sale.amount - providerAmount / parity)),
      detail,
    };
  }
  // No fixed parity (USD → XOF…): the provider's own rate is the only one known, so the fee is
  // converted at it and no separate conversion line can be told apart.
  return {
    fee:
      providerFee === undefined
        ? undefined
        : round2((providerFee * sale.amount) / providerAmount),
    conversion: 0,
    detail,
  };
}
