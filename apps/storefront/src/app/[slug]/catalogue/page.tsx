import type { Metadata } from "next";
import { siteLocale, translator, type Translate } from "@/lib/storefront-locale-core";
import { headers } from "next/headers";
import CatalogueClient from "./catalogue-client";
import { serverApi } from "@/lib/server-api";
import {
  classifyLookupFailure,
  unresolvedStorefrontMetadata,
  type OrganizationLookup,
} from "@/lib/organization-lookup";
import type { PublicOrganization } from "@/lib/public-types";
import { StorefrontOffline } from "../storefront-offline";

const SITE_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");

interface CataloguePageProps {
  params: Promise<{ slug: string }>;
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
    // Same reasoning as the storefront page: an unreachable API must not render as "this shop
    // does not exist". See classifyLookupFailure.
    return { kind: classifyLookupFailure(error) };
  }
}

/** Same per-template label used client-side (catalogue-client.tsx's CATALOGUE_LABELS) — kept as
 *  a small duplicated literal map rather than a shared import, since generateMetadata runs in a
 *  separate server-only module graph and this is the only place either needs it. */
function catalogueTitle(template: string, t: Translate): string {
  switch (template) {
    case "table":
      return t("Notre menu", "Our menu");
    case "academie":
      return t("Nos formations", "Our courses");
    case "salon":
    case "vitrine":
      return t("Nos services", "Our services");
    case "boutique":
      return t("Notre boutique", "Our shop");
    case "sejour":
      return t("Nos chambres", "Our rooms");
    case "agence":
      return t("Nos biens", "Our properties");
    default:
      return t("Notre catalogue", "Our catalogue");
  }
}

export async function generateMetadata({ params }: CataloguePageProps): Promise<Metadata> {
  const { slug } = await params;
  const canonicalUrl = `${SITE_URL}/${slug}/catalogue`;
  const lookup = await fetchOrganization(slug);

  if (lookup.kind !== "found") {
    return {
      ...unresolvedStorefrontMetadata(lookup.kind),
      robots: { index: false, follow: false },
    };
  }
  const { organization } = lookup;
  const t = translator(siteLocale(organization.language));

  const title = `${catalogueTitle(organization.storefrontTheme.template, t)} — ${organization.name}`;
  const description = t(
    `Parcourez l'ensemble du catalogue de ${organization.name}, avec recherche, filtres par catégorie et tri.`,
    `Browse ${organization.name}'s whole catalogue, with search, category filters and sorting.`,
  );

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: { title, description, type: "website", url: canonicalUrl, siteName: organization.name },
  };
}

export default async function CataloguePage({ params }: CataloguePageProps) {
  const { slug } = await params;
  if ((await fetchOrganization(slug)).kind === "offline") return <StorefrontOffline />;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <CatalogueClient slug={slug} nonce={nonce} />;
}
