import type { Metadata } from "next";
import { OnlinePaymentTerms } from "@/components/seo/online-payment-terms";

export const metadata: Metadata = {
  title: "Conditions du paiement en ligne",
  description:
    "Ce que comprend le paiement en ligne KORVA (Wave, Orange Money, MTN, Moov, carte) : frais, commissions par formule, délais, retraits et remboursements.",
  alternates: {
    canonical: "/conditions/paiement-en-ligne",
    languages: { fr: "/conditions/paiement-en-ligne", en: "/en/terms/online-payment" },
  },
};

export default function OnlinePaymentTermsRoute() {
  return <OnlinePaymentTerms locale="fr" />;
}
