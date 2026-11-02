import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import OrderDetailClient from "./order-detail-client";

interface OrderDetailPageProps {
  params: Promise<{ slug: string; id: string }>;
}

export async function generateMetadata({ params }: OrderDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Ma commande", "My order"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/orders` },
  };
}

export default async function OrderDetailPage({ params }: OrderDetailPageProps) {
  const { slug, id } = await params;
  return <OrderDetailClient slug={slug} orderId={id} />;
}
