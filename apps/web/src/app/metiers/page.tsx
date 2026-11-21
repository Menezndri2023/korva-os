import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS_MODEL_DEFINITIONS, verticalText } from "@korva/types";
import { JsonLd } from "@/components/seo/json-ld";
import { TRADE_COUNT } from "@/lib/brand";
import { appUrl } from "@/lib/site-url";
import { PublicFooter, PublicHeader } from "@/components/seo/trade-page";
import { SEO_TRADES, tradePath } from "@/lib/seo-trades";

export const metadata: Metadata = {
  // Absolute: the layout's "· KORVA OS" suffix would name the brand twice.
  title: { absolute: `KORVA OS pour ${TRADE_COUNT} métiers : salons, restaurants, boutiques, artisans…` },
  description:
    `Un logiciel de gestion configuré pour ${TRADE_COUNT} métiers : salons de coiffure, restaurants, boutiques, hôtels, centres de formation, artisans, agences, associations. Gratuit pour commencer.`,
  alternates: { canonical: "/metiers", languages: { fr: "/metiers", en: "/en/trades" } },
};

/** Every trade KORVA configures, each linking to its own page. */
export default function TradesIndex() {
  return (
    <div className="bg-paper text-ink">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "KORVA OS", item: `${appUrl()}/` },
              { "@type": "ListItem", position: 2, name: "Métiers", item: `${appUrl()}/metiers` },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            numberOfItems: SEO_TRADES.length,
            itemListElement: SEO_TRADES.map((trade, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: verticalText(trade.template, "fr").label,
              url: `${appUrl()}${tradePath(trade, "fr")}`,
            })),
          },
        ]}
      />
      <PublicHeader otherLanguageHref="/en/trades" />
      <section className="bg-ink-deep text-paper">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8">
          <h1 className="max-w-3xl text-[2rem] font-semibold leading-[1.12] tracking-[-0.02em] sm:text-[2.6rem]">
            Un logiciel de gestion configuré pour votre métier : {TRADE_COUNT} métiers pris en charge
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            Choisissez votre métier : KORVA OS arrive avec les bons outils, les bons mots et un site adapté à ce que vous vendez.
          </p>
        </div>
      </section>
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
        <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {SEO_TRADES.map((trade) => (
            <li key={trade.slug} className="border-t border-rule pt-4">
              <Link href={`/metiers/${trade.slug}`} className="group block">
                <p className="font-semibold group-hover:underline">{trade.template.label}</p>
                <p className="mt-1 text-sm text-ink-soft">{trade.template.description}</p>
                <p className="mt-1 text-xs text-ink-soft">{BUSINESS_MODEL_DEFINITIONS[trade.template.businessModel].siteKind}</p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <PublicFooter />
    </div>
  );
}
