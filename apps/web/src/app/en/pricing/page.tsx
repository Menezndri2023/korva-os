import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Pricing",
  description: "KORVA OS prices country by country: Free, Starter, Pro and Business, monthly, for 6 months or for a year, no commitment.",
  alternates: {
    canonical: LEGAL_PATHS.pricing.en,
    languages: { fr: LEGAL_PATHS.pricing.fr, en: LEGAL_PATHS.pricing.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="pricing" locale="en" />;
}
