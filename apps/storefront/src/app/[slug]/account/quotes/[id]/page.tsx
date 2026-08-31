import type { Metadata } from "next";
import QuoteDetailClient from "./quote-detail-client";

interface QuoteDetailPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata({ params }: QuoteDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Mon devis",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/quotes` },
  };
}

export default async function QuoteDetailPage({ params }: QuoteDetailPageProps) {
  const { slug, id } = await params;
  return <QuoteDetailClient slug={slug} quoteId={id} />;
}
