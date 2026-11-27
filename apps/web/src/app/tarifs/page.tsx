import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Tarifs",
  description: "Les prix de KORVA OS pays par pays : formule gratuite, Starter, Pro et Business, au mois, pour 6 mois ou pour un an, sans engagement.",
  alternates: {
    canonical: LEGAL_PATHS.pricing.fr,
    languages: { fr: LEGAL_PATHS.pricing.fr, en: LEGAL_PATHS.pricing.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="pricing" locale="fr" />;
}
