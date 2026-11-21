import type { Metadata } from "next";
import Link from "next/link";
import { BUSINESS_MODEL_DEFINITIONS, businessModelText, verticalText } from "@korva/types";
import { JsonLd } from "@/components/seo/json-ld";
import { TRADE_COUNT } from "@/lib/brand";
import { appUrl } from "@/lib/site-url";
import { PublicFooter, PublicHeader } from "@/components/seo/trade-page";
import { SEO_TRADES, tradePath } from "@/lib/seo-trades";

export const metadata: Metadata = {
  title: { absolute: `KORVA OS for ${TRADE_COUNT} trades: salons, restaurants, shops, tradespeople…` },
  description:
    `Management software set up for ${TRADE_COUNT} trades: hair salons, restaurants, shops, hotels, training centres, tradespeople, agencies, associations. Free to start.`,
  alternates: { canonical: "/en/trades", languages: { fr: "/metiers", en: "/en/trades" } },
};

/** Every trade KORVA configures, in English, each linking to its own page. */
export default function TradesIndexEn() {
  return (
    <div className="bg-paper text-ink" lang="en">
      <JsonLd
        data={[
          {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "KORVA OS", item: `${appUrl()}/en` },
              { "@type": "ListItem", position: 2, name: "Trades", item: `${appUrl()}/en/trades` },
            ],
          },
          {
            "@context": "https://schema.org",
            "@type": "ItemList",
            numberOfItems: SEO_TRADES.length,
            itemListElement: SEO_TRADES.map((trade, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: verticalText(trade.template, "en").label,
              url: `${appUrl()}${tradePath(trade, "en")}`,
            })),
          },
        ]}
      />
      <PublicHeader locale="en" otherLanguageHref="/metiers" />
      <section className="bg-ink-deep text-paper">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-8">
          <h1 className="max-w-3xl text-[2rem] font-semibold leading-[1.12] tracking-[-0.02em] sm:text-[2.6rem]">
            Management software set up for your trade: {TRADE_COUNT} trades supported
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-ink-muted">
            Pick your trade: KORVA OS comes with the right tools, the right words and a website suited to what you sell.
          </p>
        </div>
      </section>
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
        <ul className="grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
          {SEO_TRADES.map((trade) => {
            const words = verticalText(trade.template, "en");
            return (
              <li key={trade.slug} className="border-t border-rule pt-4">
                <Link href={tradePath(trade, "en")} className="group block">
                  <p className="font-semibold group-hover:underline">{words.label}</p>
                  <p className="mt-1 text-sm text-ink-soft">{words.description}</p>
                  <p className="mt-1 text-xs text-ink-soft">
                    {businessModelText(BUSINESS_MODEL_DEFINITIONS[trade.template.businessModel], "en").siteKind}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </main>
      <PublicFooter locale="en" />
    </div>
  );
}
