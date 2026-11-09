import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import { headers } from "next/headers";
import OfferDetailClient from "./offer-detail-client";
import { serverApi } from "@/lib/server-api";
import { jsonLdHtml, offerJsonLd } from "@/lib/structured-data";
import { clipText } from "@/lib/seo-text";
import {
  classifyLookupFailure,
  unresolvedStorefrontMetadata,
  type OrganizationLookup,
} from "@/lib/organization-lookup";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
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
    const organization = await serverApi.get<PublicOrganization>(
      `/public/${slug}`,
    );
    return { kind: "found", organization };
  } catch (error) {
    return { kind: classifyLookupFailure(error) };
  }
}

export async function generateMetadata({ params }: OfferDetailPageProps): Promise<Metadata> {
  const { slug, offerId } = await params;
  const t = await siteTranslator(slug);
  const canonicalUrl = `${SITE_URL}/${slug}/offers/${offerId}`;
  const lookup = await fetchOrganization(slug);

  const notFoundMetadata: Metadata = {
    title: t("Offre introuvable — KORVA OS", "Offer not found — KORVA OS"),
    description: t("Cette offre n'existe pas ou n'est plus disponible.", "This offer does not exist or is no longer available."),
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
    offer = await serverApi.get<{
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
  // The business's own words, trimmed and cut where search results cut; the fallback names the
  // business, not KORVA — this snippet is the business's advertisement.
  const description = offer.description?.trim()
    ? clipText(offer.description)
    : t(`${offer.name}, chez ${organization.name}.`, `${offer.name}, at ${organization.name}.`);
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
  const lookup = await fetchOrganization(slug);
  if (lookup.kind === "offline") return <StorefrontOffline />;
  // Same nonce middleware.ts put on the CSP's `style-src` — the offer page now renders the
  // shop's theme (see templates/storefront-theme-style.tsx).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // The offer as a product or service with its price, for search results. Best effort: the page
  // itself renders the same either way.
  let offer: PublicOffer | null = null;
  if (lookup.kind === "found") {
    offer = await serverApi.get<PublicOffer>(`/public/${slug}/offers/${offerId}`).catch(() => null);
  }
  return (
    <>
      {offer && lookup.kind === "found" && (
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: jsonLdHtml(offerJsonLd(offer, lookup.organization, `${SITE_URL}/${slug}/offers/${offerId}`)),
          }}
        />
      )}
      <OfferDetailClient slug={slug} offerId={offerId} nonce={nonce} />
    </>
  );
}
