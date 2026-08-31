import type { Metadata } from "next";
import BookingDetailClient from "./booking-detail-client";

interface BookingDetailPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata({ params }: BookingDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Ma réservation",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/bookings` },
  };
}

export default async function BookingDetailPage({ params }: BookingDetailPageProps) {
  const { slug, id } = await params;
  return <BookingDetailClient slug={slug} bookingId={id} />;
}
