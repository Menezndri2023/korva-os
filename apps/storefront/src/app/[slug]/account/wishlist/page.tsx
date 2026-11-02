import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import WishlistClient from "./wishlist-client";

interface WishlistPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: WishlistPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Ma liste de souhaits", "My wishlist"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/wishlist` },
  };
}

export default async function WishlistPage({ params }: WishlistPageProps) {
  const { slug } = await params;
  return <WishlistClient slug={slug} />;
}
