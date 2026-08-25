import type { Metadata } from "next";
import TrackClient from "./track-client";
import { publicApiClient } from "@/lib/public-api-client";
import type { PublicOrganization } from "@/lib/public-types";

interface TrackPageProps {
  params: Promise<{ slug: string }>;
}

async function fetchOrganization(slug: string): Promise<PublicOrganization | null> {
  try {
    return await publicApiClient.get<PublicOrganization>(`/public/${slug}`);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: TrackPageProps): Promise<Metadata> {
  const { slug } = await params;
  const organization = await fetchOrganization(slug);

  return {
    title: organization ? `Suivre ma commande — ${organization.name}` : "Suivre ma commande",
    description:
      "Retrouvez le statut de votre commande ou de votre réservation à partir de son numéro et de votre email.",
    // Never indexed: this page is a lookup form, not shareable content, and its query string
    // can carry a customer's order number/email.
    robots: { index: false, follow: false },
  };
}

export default async function TrackPage({ params }: TrackPageProps) {
  const { slug } = await params;
  return <TrackClient slug={slug} />;
}
