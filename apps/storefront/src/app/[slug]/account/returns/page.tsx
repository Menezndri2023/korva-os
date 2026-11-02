import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import ReturnsHistoryClient from "./returns-history-client";

interface ReturnsHistoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ReturnsHistoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Mes retours", "My returns"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/returns` },
  };
}

export default async function ReturnsHistoryPage({ params }: ReturnsHistoryPageProps) {
  const { slug } = await params;
  return <ReturnsHistoryClient slug={slug} />;
}
