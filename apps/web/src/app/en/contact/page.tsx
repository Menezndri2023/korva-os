import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact KORVA OS: e-mail, phone and WhatsApp, address in Casablanca.",
  alternates: {
    canonical: LEGAL_PATHS.contact.en,
    languages: { fr: LEGAL_PATHS.contact.fr, en: LEGAL_PATHS.contact.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="contact" locale="en" />;
}
