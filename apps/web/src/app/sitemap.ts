import type { MetadataRoute } from "next";
import { ARTICLES, articlePath } from "@/lib/articles";
import { SEO_TRADES, tradePath } from "@/lib/seo-trades";
import { appUrl } from "@/lib/site-url";

/**
 * KORVA's own public pages, in French and English, each telling search engines where its other
 * language lives. The businesses' sites have their own sitemap on sites.korvasuite.com.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  const pair = (fr: string, en: string, priority: number, changeFrequency: "weekly" | "monthly") =>
    [fr, en].map((path) => ({
      url: `${base}${path}`,
      changeFrequency,
      priority,
      alternates: { languages: { fr: `${base}${fr}`, en: `${base}${en}` } },
    }));
  return [
    ...pair("/", "/en", 1, "weekly"),
    ...pair("/metiers", "/en/trades", 0.9, "monthly"),
    ...SEO_TRADES.flatMap((trade) => pair(tradePath(trade, "fr"), tradePath(trade, "en"), 0.8, "monthly")),
    ...pair("/conseils", "/en/guides", 0.7, "weekly"),
    ...ARTICLES.flatMap((article) => pair(articlePath(article, "fr"), articlePath(article, "en"), 0.7, "monthly")),
    { url: `${base}/register`, changeFrequency: "yearly", priority: 0.5 },
  ];
}
