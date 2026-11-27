import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Politique de confidentialité",
  description: "Quelles données KORVA OS collecte, pourquoi, avec quels prestataires, combien de temps, et comment exercer vos droits (loi 09-08).",
  alternates: {
    canonical: LEGAL_PATHS.privacy.fr,
    languages: { fr: LEGAL_PATHS.privacy.fr, en: LEGAL_PATHS.privacy.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="privacy" locale="fr" />;
}
