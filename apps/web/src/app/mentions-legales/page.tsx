import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Mentions légales",
  description: "KORVA OS est édité par VIT GLOBAL TECHNOLOGIES GROUP SARLAU, Casablanca (RC 742851, ICE 004013219000041) : société, hébergeur et contact.",
  alternates: {
    canonical: LEGAL_PATHS.notice.fr,
    languages: { fr: LEGAL_PATHS.notice.fr, en: LEGAL_PATHS.notice.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="notice" locale="fr" />;
}
