import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import QuoteDetailClient from "./quote-detail-client";

interface QuoteDetailPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata({ params }: QuoteDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Mon devis", "My quote"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/quotes` },
  };
}

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const { slug, id } = await params;
  return <QuoteDetailClient slug={slug} quoteId={id} />;
}
