import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Conditions générales",
  description: "Conditions générales d'utilisation et de vente de KORVA OS : formules, essai gratuit, paiement de l'abonnement, résiliation, responsabilité.",
  alternates: {
    canonical: LEGAL_PATHS.terms.fr,
    languages: { fr: LEGAL_PATHS.terms.fr, en: LEGAL_PATHS.terms.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="terms" locale="fr" />;
}
