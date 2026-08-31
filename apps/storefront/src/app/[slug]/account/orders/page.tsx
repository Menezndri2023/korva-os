import type { Metadata } from "next";
import OrdersHistoryClient from "./orders-history-client";

interface OrdersHistoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: OrdersHistoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Mes commandes",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/orders` },
  };
}

export default async function OrdersHistoryPage({ params }: OrdersHistoryPageProps) {
  const { slug } = await params;
  return <OrdersHistoryClient slug={slug} />;
}
