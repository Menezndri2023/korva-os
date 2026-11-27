import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Remboursement et résiliation",
  description: "Résilier son abonnement KORVA OS, quand nous remboursons, et comment demander un remboursement.",
  alternates: {
    canonical: LEGAL_PATHS.refunds.fr,
    languages: { fr: LEGAL_PATHS.refunds.fr, en: LEGAL_PATHS.refunds.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="refunds" locale="fr" />;
}
