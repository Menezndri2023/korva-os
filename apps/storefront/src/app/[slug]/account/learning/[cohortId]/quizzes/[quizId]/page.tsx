import type { Metadata } from "next";
import { siteTranslator } from "@/lib/fetch-organization";
import QuizClient from "./quiz-client";

interface QuizPageProps {
  params: Promise<{ slug: string; cohortId: string; quizId: string }>;
}

export async function generateMetadata({ params }: QuizPageProps): Promise<Metadata> {
  const { slug } = await params;
  const t = await siteTranslator(slug);
  return {
    title: t("Quiz", "Quiz"),
    robots: { index: false, follow: false },
    alternates: { canonical: `/${slug}/account/learning` },
  };
}

export default async function QuizPage({ params }: QuizPageProps) {
  const { slug, cohortId, quizId } = await params;
  return <QuizClient slug={slug} cohortId={cohortId} quizId={quizId} />;
}
