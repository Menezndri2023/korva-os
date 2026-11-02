import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
import { SignedInRedirect } from "@/components/landing/signed-in-redirect";

export const metadata: Metadata = {
  title: { absolute: "KORVA OS — run your whole business in one place" },
  description:
    "Customers, appointments, orders, stock, invoices and a website in one account, set up for your trade. Card and mobile money payments. Free to start, no credit card.",
  alternates: { canonical: "/en", languages: { fr: "/", en: "/en", "x-default": "/" } },
  openGraph: {
    title: "KORVA OS — run your whole business in one place",
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
