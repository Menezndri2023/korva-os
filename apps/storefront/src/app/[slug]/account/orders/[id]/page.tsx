import type { Metadata } from "next";
import OrderDetailClient from "./order-detail-client";

interface OrderDetailPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata({ params }: OrderDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Ma commande",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/orders` },
  };
}

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { slug, id } = await params;
  return <OrderDetailClient slug={slug} orderId={id} />;
}
