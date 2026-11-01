import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TradePage } from "@/components/seo/trade-page";
import { seoTradeBySlug } from "@/lib/seo-trades";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const trade = seoTradeBySlug((await params).slug);
  if (!trade) return {};
  const description = `${trade.scene} KORVA OS rassemble clients, ventes, caisse et site internet pour ${trade.audience}. Paiement Wave, Orange Money et carte. Gratuit pour commencer.`;
  return {
    title: trade.heading,
    description,
    alternates: { canonical: `/metiers/${trade.slug}` },
    openGraph: { title: trade.heading, description, url: `/metiers/${trade.slug}`, type: "website" },
  };
}

export default async function TradeRoute({ params }: Props) {
  const trade = seoTradeBySlug((await params).slug);
  if (!trade) notFound();
  return <TradePage trade={trade} />;
}
