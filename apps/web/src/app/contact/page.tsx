import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contacter KORVA OS : e-mail, téléphone et WhatsApp, adresse à Casablanca.",
  alternates: {
    canonical: LEGAL_PATHS.contact.fr,
    languages: { fr: LEGAL_PATHS.contact.fr, en: LEGAL_PATHS.contact.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="contact" locale="fr" />;
}
