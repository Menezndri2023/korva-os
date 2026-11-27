import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Refunds and cancellation",
  description: "Cancelling your KORVA OS subscription, when we refund, and how to ask for a refund.",
  alternates: {
    canonical: LEGAL_PATHS.refunds.en,
    languages: { fr: LEGAL_PATHS.refunds.fr, en: LEGAL_PATHS.refunds.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="refunds" locale="en" />;
}
