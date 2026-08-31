import type { Metadata } from "next";
import BookingsHistoryClient from "./bookings-history-client";

interface BookingsHistoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: BookingsHistoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Mes réservations",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/bookings` },
  };
}

export default async function BookingsHistoryPage({ params }: BookingsHistoryPageProps) {
  const { slug } = await params;
  return <BookingsHistoryClient slug={slug} />;
}
