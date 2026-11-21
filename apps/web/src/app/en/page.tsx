import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { SignedInRedirect } from "@/components/landing/signed-in-redirect";
import { BRAND_KEYWORDS_EN, BRAND_NAME, HOME_DESCRIPTION_EN, HOME_TITLE_EN } from "@/lib/brand";

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE_EN },
  description: HOME_DESCRIPTION_EN,
  keywords: BRAND_KEYWORDS_EN,
  alternates: { canonical: "/en", languages: { fr: "/", en: "/en", "x-default": "/" } },
  openGraph: {
    type: "website",
    siteName: BRAND_NAME,
    title: HOME_TITLE_EN,
    description:
      "Your notebook, your appointment book and your till in one place. Pick your trade and your workspace is ready.",
    locale: "en_GB",
    url: "/en",
  },
};

export default function HomeEn() {
  return (
    <>
      <SignedInRedirect />
      <LandingPage locale="en" />
    </>
  );
}
