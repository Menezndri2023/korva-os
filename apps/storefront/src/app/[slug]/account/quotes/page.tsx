import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import QuotesHistoryClient from "./quotes-history-client";

interface QuotesHistoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: QuotesHistoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Mes devis", "My quotes"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/quotes` },
  };
}

export default async function QuotesHistoryPage({ params }: QuotesHistoryPageProps) {
  const { slug } = await params;
  return <QuotesHistoryClient slug={slug} />;
}
