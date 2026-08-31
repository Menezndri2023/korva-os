import type { Metadata } from "next";
import ReturnsHistoryClient from "./returns-history-client";

interface ReturnsHistoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ReturnsHistoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Mes retours",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/returns` },
  };
}

export default async function ReturnsHistoryPage({ params }: ReturnsHistoryPageProps) {
  const { slug } = await params;
  return <ReturnsHistoryClient slug={slug} />;
}
