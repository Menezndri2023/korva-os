import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Terms and conditions",
  description: "KORVA OS terms of use and sale: plans, free trial, subscription payment, cancellation, liability.",
  alternates: {
    canonical: LEGAL_PATHS.terms.en,
    languages: { fr: LEGAL_PATHS.terms.fr, en: LEGAL_PATHS.terms.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="terms" locale="en" />;
}
