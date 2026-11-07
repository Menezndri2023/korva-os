import type { Metadata } from "next";
import { OnlinePaymentTerms } from "@/components/seo/online-payment-terms";

export const metadata: Metadata = {
  title: "Online payment terms",
  description:
    "What KORVA online payment includes (Wave, Orange Money, MTN, Moov, card): fees, commission by plan, delays, withdrawals and refunds.",
  alternates: {
    canonical: "/en/terms/online-payment",
    languages: { fr: "/conditions/paiement-en-ligne", en: "/en/terms/online-payment" },
  },
};

export default function OnlinePaymentTermsRouteEn() {
  return <OnlinePaymentTerms locale="en" />;
}
