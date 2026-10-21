import type { Metadata } from "next";
import OfferDetailClient from "./offer-detail-client";
import { publicApiClient } from "@/lib/public-api-client";
import {
  classifyLookupFailure,
  unresolvedStorefrontMetadata,
  type OrganizationLookup,
} from "@/lib/organization-lookup";
import type { PublicOrganization } from "@/lib/public-types";
import { StorefrontOffline } from "../../storefront-offline";

// Server-side only — see the same note in ../page.tsx.
const SITE_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");

interface OfferDetailPageProps {
  params: Promise<{ slug: string; offerId: string }>;
}

async function fetchOrganization(
  slug: string,
): Promise<OrganizationLookup<PublicOrganization>> {
  try {
    const organization = await publicApiClient.get<PublicOrganization>(
      `/public/${slug}`,
    );
    return { kind: "found", organization };
  } catch (error) {
    return { kind: classifyLookupFailure(error) };
  }
}

export async function generateMetadata({ params }: OfferDetailPageProps): Promise<Metadata> {
  const { slug, offerId } = await params;
  const canonicalUrl = `${SITE_URL}/${slug}/offers/${offerId}`;
  const lookup = await fetchOrganization(slug);

  const notFoundMetadata: Metadata = {
    title: "Offre introuvable — KORVA OS",
    description: "Cette offre n'existe pas ou n'est plus disponible.",
    alternates: { canonical: canonicalUrl },
    robots: { index: false, follow: false },
  };
  // An unreachable API is not a missing offer. Only the SHOP lookup is split here; the offer
  // lookup below keeps its single answer on purpose, because PublicService#getOffer makes
  // "never existed" and "draft/archived" deliberately indistinguishable.
  if (lookup.kind === "unavailable" || lookup.kind === "offline") {
    return {
      ...unresolvedStorefrontMetadata(lookup.kind),
      alternates: { canonical: canonicalUrl },
      robots: { index: false, follow: false },
    };
  }
  if (
    lookup.kind === "absent" ||
    !lookup.organization.enabledModules.includes("catalog")
  ) {
    return notFoundMetadata;
  }
  const { organization } = lookup;

  let offer;
  try {
    offer = await publicApiClient.get<{
      name: string;
      description?: string;
      images: string[];
    }>(`/public/${slug}/offers/${offerId}`);
  } catch {
    // Same generic-404 metadata whether the offer never existed or is a draft/archived — see
    // PublicService#getOffer for why those two cases are deliberately indistinguishable.
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
  if ((await fetchOrganization(slug)).kind === "offline") return <StorefrontOffline />;
  return <OfferDetailClient slug={slug} offerId={offerId} />;
}
