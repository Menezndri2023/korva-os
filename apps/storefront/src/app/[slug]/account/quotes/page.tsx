import type { Metadata } from "next";
import QuotesHistoryClient from "./quotes-history-client";

interface QuotesHistoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: QuotesHistoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Mes devis",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/quotes` },
  };
}

export default async function QuotesHistoryPage({ params }: QuotesHistoryPageProps) {
  const { slug } = await params;
  return <QuotesHistoryClient slug={slug} />;
}
