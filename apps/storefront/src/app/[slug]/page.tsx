import type { Metadata } from "next";
import { headers } from "next/headers";
import StorefrontClient from "./storefront-client";
import { publicApiClient } from "@/lib/public-api-client";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";

// Server-side only (not NEXT_PUBLIC_*): generateMetadata and sitemap/robots run in the Node
// runtime, never in the browser bundle, so there's no need to expose this to client code.
const SITE_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");

interface StorefrontPageProps {
  params: Promise<{ slug: string }>;
}

async function fetchOrganization(slug: string): Promise<PublicOrganization | null> {
  try {
    return await publicApiClient.get<PublicOrganization>(`/public/${slug}`);
  } catch {
    // Unknown/unavailable slug — the client component renders its own "boutique introuvable"
    // state; here we just fall back to non-indexable metadata for that same case.
    return null;
  }
}

async function fetchOfferSample(slug: string, organization: PublicOrganization): Promise<PublicOffer[]> {
  if (!organization.enabledModules.includes("catalog")) {
    return [];
  }
  try {
    return await publicApiClient.get<PublicOffer[]>(`/public/${slug}/offers`);
  } catch {
    return [];
  }
}

export async function generateMetadata({ params }: StorefrontPageProps): Promise<Metadata> {
  const { slug } = await params;
  const canonicalUrl = `${SITE_URL}/${slug}`;
  const organization = await fetchOrganization(slug);

  if (!organization) {
    return {
      title: "Boutique introuvable — KORVA OS",
      description: "Cette boutique n'existe pas ou n'est plus disponible.",
      alternates: { canonical: canonicalUrl },
      robots: { index: false, follow: false },
    };
  }

  const offers = await fetchOfferSample(slug, organization);
  const offerNames = offers.slice(0, 3).map((offer) => offer.name);

  const services: string[] = [];
  if (organization.enabledModules.includes("booking")) {
    services.push("réservation en ligne");
  }
  if (organization.enabledModules.includes("commerce")) {
    services.push("commande en ligne");
  }

  const autoDescriptionParts = [`${organization.name} — boutique propulsée par KORVA OS.`];
  if (services.length > 0) {
    autoDescriptionParts.push(`Services : ${services.join(", ")}.`);
  }
  if (offerNames.length > 0) {
    autoDescriptionParts.push(`Offres : ${offerNames.join(", ")}.`);
  }

  // Phase E4 (docs/KORVA_OS_V2_AUDIT.md §2.6): an org-configured seoTitle/seoDescription always
  // wins over the auto-derived fallback above — see Organization.seoTitle's own doc comment
  // (apps/api) for why this is available at every plan tier, unlike the content sections.
  const title = organization.seoTitle || organization.name;
  const description = organization.seoDescription || autoDescriptionParts.join(" ");

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
      // Only set when the organization actually has a logo on file — never a placeholder image.
      ...(organization.logo ? { images: [{ url: organization.logo }] } : {}),
    },
    twitter: {
      card: organization.logo ? "summary_large_image" : "summary",
      title,
      description,
      ...(organization.logo ? { images: [organization.logo] } : {}),
    },
  };
}

export default async function StorefrontPage({ params }: StorefrontPageProps) {
  const { slug } = await params;
  // Same nonce middleware.ts put on the CSP's `style-src` for this request — see
  // templates/storefront-theme-style.tsx for why StorefrontClient needs it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <StorefrontClient slug={slug} nonce={nonce} />;
}
