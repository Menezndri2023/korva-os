import { cache } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import StorefrontClient from "./storefront-client";
import { serverApi } from "@/lib/server-api";
import { businessJsonLd, jsonLdHtml } from "@/lib/structured-data";
import { unresolvedStorefrontMetadata } from "@/lib/organization-lookup";
import { fetchOrganization } from "@/lib/fetch-organization";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { StorefrontOffline } from "./storefront-offline";


// Server-side only (not NEXT_PUBLIC_*): generateMetadata and sitemap/robots run in the Node
// runtime, never in the browser bundle, so there's no need to expose this to client code.
const SITE_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");

interface StorefrontPageProps {
  params: Promise<{ slug: string }>;
}

/**
 * Gated on `visibleSections`, not `enabledModules`. visibleSections is the narrower of the two —
 * the API intersects the enabled module with the organization's own storefrontSections choice —
 * so an organization that keeps the catalog for internal use but hides it from its public page
 * was previously having its offer names listed in that page's own meta description. It is also
 * the exact condition StorefrontClient uses to decide whether to run its offers query, which is
 * what makes the result below usable as that query's initial data.
 *
 * Cached for the same reason as fetchOrganization.
 */
const fetchOfferSample = cache(
  async (slug: string, catalogVisible: boolean): Promise<PublicOffer[]> => {
    if (!catalogVisible) {
      return [];
    }
    try {
      return await serverApi.get<PublicOffer[]>(`/public/${slug}/offers`);
    } catch {
      return [];
    }
  },
);

export async function generateMetadata({ params }: StorefrontPageProps): Promise<Metadata> {
  const { slug } = await params;
  const canonicalUrl = `${SITE_URL}/${slug}`;
  const lookup = await fetchOrganization(slug);

  if (lookup.kind !== "found") {
    // Two different titles for two different facts. "Introuvable" when the API confirmed there
    // is nothing here; "momentanément indisponible" when we could not reach it — a shop whose
    // API is down has not stopped existing, and saying so to its customers is a lie that costs
    // the business, not us. `noindex` either way: neither state is worth recording.
    return {
      ...unresolvedStorefrontMetadata(lookup.kind),
      alternates: { canonical: canonicalUrl },
      robots: { index: false, follow: false },
    };
  }
  const { organization } = lookup;

  const offers = await fetchOfferSample(
    slug,
    organization.visibleSections.includes("catalog"),
  );
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

/**
 * Fetches the page's data on the server and hands it to StorefrontClient as initial data.
 *
 * Without this the tenant site shipped NO CONTENT in its HTML. StorefrontClient is a client
 * component, so Next renders it on the server — but its two react-query hooks have nothing to
 * render during that pass, so the server emitted the loading skeleton and the browser then
 * re-fetched everything. A crawler saw meta tags and an empty page, and a visitor on mobile data
 * waited for the bundle plus two API round trips before the first word appeared. Both matter
 * more here than anywhere else in the product: this IS the customer's website, and the markets
 * it ships to are mobile-majority.
 *
 * Costs nothing extra: generateMetadata already made both calls, and `cache()` above now means
 * all of it is one request each.
 */
export default async function StorefrontPage({ params }: StorefrontPageProps) {
  const { slug } = await params;
  // Same nonce middleware.ts put on the CSP's `style-src` for this request — see
  // templates/storefront-theme-style.tsx for why StorefrontClient needs it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const lookup = await fetchOrganization(slug);

  // Called outside any try/catch, and in the render path, as notFound() requires: it works by
  // throwing NEXT_HTTP_ERROR_FALLBACK;404, which a catch would swallow.
  //
  // One honest caveat, from Next's own not-found.js reference: a 404 status is returned only for
  // NON-streamed responses — a streamed one has already sent 200 before this throws. So this
  // guarantees the right PAGE and an automatic `noindex`, and the status code depends on whether
  // this route streams. Which is why the user-visible message, not the status, is the part of
  // this change that actually matters.
  if (lookup.kind === "absent") {
    notFound();
  }
  if (lookup.kind === "offline") {
    return <StorefrontOffline />;
  }

  const organization = lookup.kind === "found" ? lookup.organization : undefined;
  const offers = organization
    ? await fetchOfferSample(
        slug,
        organization.visibleSections.includes("catalog"),
      )
    : [];

  return (
    <>
      {organization && (
        // What the business is, for search engines and AI assistants (see structured-data.ts).
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: jsonLdHtml(businessJsonLd(organization, `${SITE_URL}/${slug}`)) }}
        />
      )}
      <StorefrontClient
      slug={slug}
      nonce={nonce}
      // Never passed as initial data when absent: react-query would treat it as a successful
      // empty result and StorefrontClient would stop retrying.
      initialOrganization={organization}
      initialOffers={offers}
    />
    </>
  );
}
