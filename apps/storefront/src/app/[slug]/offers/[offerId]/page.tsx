import type { Metadata } from "next";
import OfferDetailClient from "./offer-detail-client";
import { publicApiClient } from "@/lib/public-api-client";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";

// Server-side only — see the same note in ../page.tsx.
const SITE_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");

interface OfferDetailPageProps {
  params: Promise<{ slug: string; offerId: string }>;
}

async function fetchOrganization(slug: string): Promise<PublicOrganization | null> {
  try {
    return await publicApiClient.get<PublicOrganization>(`/public/${slug}`);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: OfferDetailPageProps): Promise<Metadata> {
  const { slug, offerId } = await params;
  const canonicalUrl = `${SITE_URL}/${slug}/offers/${offerId}`;
  const organization = await fetchOrganization(slug);

  const notFoundMetadata: Metadata = {
    title: "Offre introuvable — KORVA OS",
    description: "Cette offre n'existe pas ou n'est plus disponible.",
    alternates: { canonical: canonicalUrl },
    robots: { index: false, follow: false },
  };
  if (!organization || !organization.enabledModules.includes("catalog")) {
    return notFoundMetadata;
  }

  // GET /public/:slug/offers has no single-offer lookup — it returns the organization's whole
  // active catalog (server-capped at page 1 / 50 items, see PublicService#listOffers). We look
  // up the requested id from that same list, exactly like the client component does. A catalog
  // with more than 50 active offers can contain items that exist but aren't reachable this way —
  // see this wave's BACKEND CONTRACT REQUIRED note for a proper GET /public/:slug/offers/:id.
  let offers: PublicOffer[] = [];
  try {
    offers = await publicApiClient.get<PublicOffer[]>(`/public/${slug}/offers`);
  } catch {
    return notFoundMetadata;
  }
  const offer = offers.find((o) => o.id === offerId);
  if (!offer) {
    return notFoundMetadata;
  }

  const title = `${offer.name} — ${organization.name}`;
  const description =
    offer.description ?? `${offer.name}, proposé par ${organization.name} sur KORVA OS.`;
  const image = offer.images[0];

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title,
      description,
      type: "website",
      url: canonicalUrl,
      siteName: organization.name,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      ...(image ? { images: [image] } : {}),
    },
  };
}

export default async function OfferDetailPage({ params }: OfferDetailPageProps) {
  const { slug, offerId } = await params;
  return <OfferDetailClient slug={slug} offerId={offerId} />;
}
