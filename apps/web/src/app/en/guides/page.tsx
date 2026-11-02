import type { Metadata } from "next";
import { ArticleIndex } from "@/components/seo/article-page";

export const metadata: Metadata = {
  title: "Guides for shop owners, tradespeople and service providers",
  description:
    "Take mobile money and card payments, reduce missed appointments, get quotes signed: practical guides to run your business.",
  alternates: { canonical: "/en/guides", languages: { fr: "/conseils", en: "/en/guides" } },
};

export default function EnglishGuidesIndexRoute() {
  return <ArticleIndex locale="en" />;
}
