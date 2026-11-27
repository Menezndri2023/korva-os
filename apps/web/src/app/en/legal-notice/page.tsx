import type { Metadata } from "next";
import { LegalPageView } from "@/components/seo/legal-pages";
import { LEGAL_PATHS } from "@/lib/legal-paths";

export const metadata: Metadata = {
  title: "Legal notice",
  description: "KORVA OS is published by VIT GLOBAL TECHNOLOGIES GROUP SARLAU, Casablanca (RC 742851, ICE 004013219000041): company, host and contact.",
  alternates: {
    canonical: LEGAL_PATHS.notice.en,
    languages: { fr: LEGAL_PATHS.notice.fr, en: LEGAL_PATHS.notice.en },
  },
};

export default function LegalRoute() {
  return <LegalPageView page="notice" locale="en" />;
}
