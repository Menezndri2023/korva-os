import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What data KORVA OS collects, why, with which providers, for how long, and how to exercise your rights.",
  alternates: {
    canonical: LEGAL_PATHS.privacy.en,
    languages: { fr: LEGAL_PATHS.privacy.fr, en: LEGAL_PATHS.privacy.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="privacy" locale="en" />;
}
