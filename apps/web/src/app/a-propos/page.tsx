import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Qui sommes-nous",
  description: "KORVA OS est édité par VIT GLOBAL TECHNOLOGIES GROUP, groupe technologique basé à Casablanca, au service des entreprises d'Afrique francophone.",
  alternates: {
    canonical: LEGAL_PATHS.about.fr,
    languages: { fr: LEGAL_PATHS.about.fr, en: LEGAL_PATHS.about.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="about" locale="fr" />;
}
