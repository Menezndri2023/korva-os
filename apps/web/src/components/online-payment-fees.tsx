"use client";

import {
  commissionPercentLabel,
  estimateSale,
  minimumOnlinePayment,
  providerExchangeLossShare,
  type PlanKey,
} from "@korva/types";
import { Notice } from "@korva/ui";
import { formatCurrency } from "@/lib/analytics-format";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

/**
 * Everything a business pays on an online sale, said BEFORE it turns online payment on and again
 * on its Solde: GeniusPay's fee by method, KORVA's commission, the withdrawal fee, the minimum — and,
 * for a shop priced in another currency than the CFA franc, the exchange loss, because GeniusPay
 * charges every customer in XOF at its own rate (validated by the user 2026-11-07: international
 * payment stays open, with the business warned of what it costs).
 */
export function OnlinePaymentFees({ currency, plan }: { currency: string; plan: PlanKey }) {
  const t = useT();
  const locale = useDashboardLocale();
  const code = currency.toUpperCase();
  const local = code === "XOF" || code === "XAF";
  const loss = providerExchangeLossShare(code);
  const minimum = minimumOnlinePayment(code);
  const money = (amount: number) => formatCurrency(amount, code, locale);
  const commission = locale === "en" ? commissionPercentLabel(plan).replace(",", ".") : commissionPercentLabel(plan);
  const exampleAmount = local ? 10_000 : 10;
  const example = estimateSale(exampleAmount, "card", plan, code);

  return (
    <div className="space-y-2">
      <p className="text-xs text-text-muted">
        {t(
          `Sur chaque paiement en ligne : frais GeniusPay (Wave 2,5 % + 100 F, Orange, MTN et Moov 4,5 % + 100 F, carte 6 % + 100 F), commission KORVA de ${commission} (votre formule), puis 1 % au retrait vers votre numéro.`,
          `On each online payment: GeniusPay's fee (Wave 2.5% + 100 F, Orange, MTN and Moov 4.5% + 100 F, card 6% + 100 F), a KORVA commission of ${commission} (your plan), then 1% when you withdraw to your number.`,
        )}
        {minimum > 0 &&
          ` ${t(
            `Paiement en ligne à partir de ${money(minimum)} : en dessous, le client paie sur place.`,
            `Online payment from ${money(minimum)}: below that, the customer pays in person.`,
          )}`}
      </p>
      {!local && (
        <Notice tone="warning">
          {loss !== null
            ? t(
                `Votre boutique est en ${code}. GeniusPay fait payer vos clients en francs CFA, à son propre taux : environ 610,70 F pour 1 € alors que le taux officiel est de 655,957 F. Environ ${(loss * 100).toFixed(1).replace(".", ",")} % de chaque vente part dans le change, en plus des frais.${example ? ` Exemple : une vente de ${money(exampleAmount)} payée par carte vous rapporte environ ${money(example.received)}.` : ""}`,
                `Your shop is in ${code}. GeniusPay charges your customers in CFA francs at its own rate: about 610.70 F for €1, while the official rate is 655.957 F. About ${(loss * 100).toFixed(1)}% of each sale is lost to the exchange, on top of the fees.${example ? ` Example: a ${money(exampleAmount)} sale paid by card brings you about ${money(example.received)}.` : ""}`,
              )
            : t(
                `Votre boutique est en ${code}. GeniusPay fait payer vos clients en francs CFA, à son propre taux de change : une partie de chaque vente part dans le change, en plus des frais. Le montant exact apparaît sur votre Solde après chaque vente.`,
                `Your shop is in ${code}. GeniusPay charges your customers in CFA francs at its own exchange rate: part of each sale is lost to the exchange, on top of the fees. The exact amount shows on your Balance after each sale.`,
              )}
        </Notice>
      )}
    </div>
  );
}
