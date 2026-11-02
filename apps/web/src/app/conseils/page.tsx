import type { Metadata } from "next";
import { ArticleIndex } from "@/components/seo/article-page";

export const metadata: Metadata = {
  title: "Conseils pour commerçants, artisans et prestataires",
  description:
    "Encaisser par Wave, Orange Money ou carte, réduire les rendez-vous manqués, faire signer un devis : des conseils concrets pour gérer votre activité.",
  alternates: { canonical: "/conseils", languages: { fr: "/conseils", en: "/en/guides" } },
};

export default function GuidesIndexRoute() {
  return <ArticleIndex locale="fr" />;
}
