import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticlePage } from "@/components/seo/article-page";
import { ARTICLES, articleBySlug, articlePath } from "@/lib/articles";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return ARTICLES.map((article) => ({ slug: article.fr.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = articleBySlug((await params).slug, "fr");
  if (!article) return {};
  const path = articlePath(article, "fr");
  return {
    title: article.fr.title,
    description: article.fr.description,
    alternates: {
      canonical: path,
      languages: { fr: articlePath(article, "fr"), en: articlePath(article, "en") },
    },
    openGraph: {
      title: article.fr.title,
      description: article.fr.description,
      url: path,
      type: "article",
      publishedTime: article.published,
    },
  };
}

export default async function GuideRoute({ params }: Props) {
  const article = articleBySlug((await params).slug, "fr");
  if (!article) notFound();
  return <ArticlePage article={article} locale="fr" />;
}
