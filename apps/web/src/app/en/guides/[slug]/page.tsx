import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticlePage } from "@/components/seo/article-page";
import { ARTICLES, articleBySlug, articlePath } from "@/lib/articles";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return ARTICLES.map((article) => ({ slug: article.en.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = articleBySlug((await params).slug, "en");
  if (!article) return {};
  const path = articlePath(article, "en");
  return {
    title: article.en.title,
    description: article.en.description,
    alternates: {
      canonical: path,
      languages: { fr: articlePath(article, "fr"), en: articlePath(article, "en") },
    },
    openGraph: {
      title: article.en.title,
      description: article.en.description,
      url: path,
      type: "article",
      publishedTime: article.published,
    },
  };
}

export default async function EnglishGuideRoute({ params }: Props) {
  const article = articleBySlug((await params).slug, "en");
  if (!article) notFound();
  return <ArticlePage article={article} locale="en" />;
}
