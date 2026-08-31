import type { Metadata } from "next";
import WishlistClient from "./wishlist-client";

interface WishlistPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: WishlistPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Ma liste de souhaits",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/wishlist` },
  };
}

export default async function WishlistPage({ params }: WishlistPageProps) {
  const { slug } = await params;
  return <WishlistClient slug={slug} />;
}
