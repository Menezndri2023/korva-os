import type { Metadata } from "next";
import LearningClient from "./learning-client";

interface LearningPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: LearningPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: "Mes formations",
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/learning` },
  };
}

export default async function LearningPage({ params }: LearningPageProps) {
  const { slug } = await params;
  return <LearningClient slug={slug} />;
}
