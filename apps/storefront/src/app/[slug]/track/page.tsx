import type { Metadata } from "next";
import TrackClient from "./track-client";
import { serverApi } from "@/lib/server-api";
import type { PublicOrganization } from "@/lib/public-types";
import { siteLocale, translator } from "@/lib/storefront-locale-core";

interface TrackPageProps {
  params: Promise<{ slug: string }>;
}

async function fetchOrganization(slug: string): Promise<PublicOrganization | null> {
  try {
    return await serverApi.get<PublicOrganization>(`/public/${slug}`);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: TrackPageProps): Promise<Metadata> {
  const { slug } = await params;
  const organization = await fetchOrganization(slug);
  const t = translator(siteLocale(organization?.language));

  return {
    title: organization
      ? t(`Suivre ma commande — ${organization.name}`, `Track my order — ${organization.name}`)
      : t("Suivre ma commande", "Track my order"),
    description: t(
      "Retrouvez le statut de votre commande ou de votre réservation à partir de son numéro et de votre email.",
      "Find the status of your order or booking from its number and your e-mail.",
    ),
    // Never indexed: this page is a lookup form, not shareable content, and its query string
    // can carry a customer's order number/email.
    robots: { index: false, follow: false },
  };
}

export default async function TrackPage({ params }: TrackPageProps) {
  const { slug } = await params;
  return <TrackClient slug={slug} />;
}
