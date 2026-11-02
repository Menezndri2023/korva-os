import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import CohortClient from "./cohort-client";

interface CohortPageProps {
  params: Promise<{ slug: string; cohortId: string }>;
}

export async function generateMetadata({ params }: CohortPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Ma formation", "My course"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/learning` },
  };
}

export default async function CohortPage({ params }: CohortPageProps) {
  const { slug, cohortId } = await params;
  return <CohortClient slug={slug} cohortId={cohortId} />;
}
