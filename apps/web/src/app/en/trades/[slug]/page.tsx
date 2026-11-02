import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TradePage } from "@/components/seo/trade-page";
import { seoTradeBySlug, tradePath } from "@/lib/seo-trades";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const trade = seoTradeBySlug((await params).slug, "en");
  if (!trade) return {};
  const description = `${trade.en.scene} KORVA OS brings customers, sales, till and website together for ${trade.en.audience}. Card and mobile money payments. Free to start.`;
  return {
    title: trade.en.heading,
    description,
    alternates: {
      canonical: tradePath(trade, "en"),
      languages: { fr: tradePath(trade, "fr"), en: tradePath(trade, "en") },
    },
    openGraph: { title: trade.en.heading, description, url: tradePath(trade, "en"), type: "website", locale: "en_GB" },
  };
}

export default async function TradeRouteEn({ params }: Props) {
  const trade = seoTradeBySlug((await params).slug, "en");
  if (!trade) notFound();
  return <TradePage trade={trade} locale="en" />;
}
