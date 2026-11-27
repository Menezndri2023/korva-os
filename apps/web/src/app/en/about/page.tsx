import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "About us",
  description: "KORVA OS is published by VIT GLOBAL TECHNOLOGIES GROUP, a technology group based in Casablanca serving businesses in French-speaking Africa.",
  alternates: {
    canonical: LEGAL_PATHS.about.en,
    languages: { fr: LEGAL_PATHS.about.fr, en: LEGAL_PATHS.about.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="about" locale="en" />;
}
