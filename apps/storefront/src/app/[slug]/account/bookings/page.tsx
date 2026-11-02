import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import BookingsHistoryClient from "./bookings-history-client";

interface BookingsHistoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: BookingsHistoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Mes réservations", "My bookings"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/bookings` },
  };
}

export default async function BookingsHistoryPage({ params }: BookingsHistoryPageProps) {
  const { slug } = await params;
  return <BookingsHistoryClient slug={slug} />;
}
