import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import OrdersHistoryClient from "./orders-history-client";

interface OrdersHistoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: OrdersHistoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Mes commandes", "My orders"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/orders` },
  };
}

export default async function OrdersHistoryPage({ params }: OrdersHistoryPageProps) {
  const { slug } = await params;
  return <OrdersHistoryClient slug={slug} />;
}
