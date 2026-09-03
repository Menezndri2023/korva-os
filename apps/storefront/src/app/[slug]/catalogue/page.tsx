import type { Metadata } from "next";
import { headers } from "next/headers";
import CatalogueClient from "./catalogue-client";
import { publicApiClient } from "@/lib/public-api-client";
import type { PublicOrganization } from "@/lib/public-types";

const SITE_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");

interface CataloguePageProps {
  params: Promise<{ slug: string }>;
}

async function fetchOrganization(slug: string): Promise<PublicOrganization | null> {
  try {
    return await publicApiClient.get<PublicOrganization>(`/public/${slug}`);
  } catch {
    return null;
  }
}

/** Same per-template label used client-side (catalogue-client.tsx's CATALOGUE_LABELS) — kept as
 *  a small duplicated literal map rather than a shared import, since generateMetadata runs in a
 *  separate server-only module graph and this is the only place either needs it. */
function catalogueTitle(template: string): string {
  switch (template) {
    case "table":
      return "Notre menu";
    case "academie":
      return "Nos formations";
    case "salon":
    case "vitrine":
      return "Nos services";
    case "boutique":
      return "Notre boutique";
    default:
      return "Notre catalogue";
  }
}

export async function generateMetadata({ params }: CataloguePageProps): Promise<Metadata> {
  const { slug } = await params;
  const canonicalUrl = `${SITE_URL}/${slug}/catalogue`;
  const organization = await fetchOrganization(slug);

  if (!organization) {
    return {
      title: "Boutique introuvable — KORVA OS",
      robots: { index: false, follow: false },
    };
  }

  const title = `${catalogueTitle(organization.storefrontTheme.template)} — ${organization.name}`;
  const description = `Parcourez l'ensemble du catalogue de ${organization.name}, avec recherche, filtres par catégorie et tri.`;

  return {
    title,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: { title, description, type: "website", url: canonicalUrl, siteName: organization.name },
  };
}

export default async function CataloguePage({ params }: CataloguePageProps) {
  const { slug } = await params;
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return <CatalogueClient slug={slug} nonce={nonce} />;
}
