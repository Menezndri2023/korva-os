import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import ReviewInvitationClient from "./review-invitation-client";

interface ReviewPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
}

export async function generateMetadata({ params }: ReviewPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Donner mon avis", "Leave my review"),
    // The link is personal: never indexed, and its token never leaves in a Referer header.
    robots: { index: false, follow: false },
    referrer: "no-referrer",
    alternates: { canonical: `/${slug}/avis` },
  };
}

/** Opened from the "Donnez votre avis" message sent once an order is delivered or a booking
 *  completed — see ReviewRequestsService in the API. No account needed: the link is the proof. */
export default async function ReviewPage({ params, searchParams }: ReviewPageProps) {
  const [{ slug }, { t }] = await Promise.all([params, searchParams]);
  return <ReviewInvitationClient slug={slug} token={typeof t === "string" ? t : ""} />;
}
