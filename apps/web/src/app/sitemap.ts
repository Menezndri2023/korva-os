import type { MetadataRoute } from "next";
import { SEO_TRADES } from "@/lib/seo-trades";
import { appUrl } from "@/lib/site-url";

/** KORVA's own public pages. The businesses' sites have their own sitemap on sites.korvasuite.com. */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/metiers`, changeFrequency: "monthly", priority: 0.9 },
    ...SEO_TRADES.map((trade) => ({
      url: `${base}/metiers/${trade.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    { url: `${base}/register`, changeFrequency: "yearly", priority: 0.5 },
  ];
}
