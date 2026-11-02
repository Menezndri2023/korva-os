import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import LearningClient from "./learning-client";

interface LearningPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: LearningPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Mes formations", "My courses"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/learning` },
  };
}

export default async function LearningPage({ params }: LearningPageProps) {
  const { slug } = await params;
  return <LearningClient slug={slug} />;
}
