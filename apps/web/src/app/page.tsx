import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { SignedInRedirect } from "@/components/landing/signed-in-redirect";
import { BRAND_NAME, HOME_DESCRIPTION_FR, HOME_TITLE_FR } from "@/lib/brand";

/**
 * The public home page in French, plus the redirect for anyone already signed in.
 *
 * The landing markup renders unconditionally, so it is in the server-rendered HTML on first paint
 * and crawlers see it without executing anything; a signed-in visitor briefly sees it before
 * SignedInRedirect sends them on. The English page lives at /en.
 */
export const metadata: Metadata = {
  title: { absolute: HOME_TITLE_FR },
  description: HOME_DESCRIPTION_FR,
  alternates: { canonical: "/", languages: { fr: "/", en: "/en", "x-default": "/" } },
  // A page-level openGraph replaces the layout's whole block, so everything is restated here —
  // the point being og:url, which only this page can state.
  openGraph: {
    type: "website",
    siteName: BRAND_NAME,
    locale: "fr_FR",
    url: "/",
    title: HOME_TITLE_FR,
    description:
      "Votre cahier, votre carnet de rendez-vous et votre caisse au même endroit. " +
      "Choisissez votre métier, votre espace est déjà configuré.",
  },
};

export default function Home() {
  return (
    <>
      <SignedInRedirect />
      <LandingPage />
    </>
  );
}
