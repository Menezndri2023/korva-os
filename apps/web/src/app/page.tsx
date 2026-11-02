import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { SignedInRedirect } from "@/components/landing/signed-in-redirect";

/**
 * The public home page in French, plus the redirect for anyone already signed in.
 *
 * The landing markup renders unconditionally, so it is in the server-rendered HTML on first paint
 * and crawlers see it without executing anything; a signed-in visitor briefly sees it before
 * SignedInRedirect sends them on. The English page lives at /en.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/", languages: { fr: "/", en: "/en", "x-default": "/" } },
};

export default function Home() {
  return (
    <>
      <SignedInRedirect />
      <LandingPage />
    </>
  );
}
