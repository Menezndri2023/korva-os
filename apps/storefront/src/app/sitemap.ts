import type { MetadataRoute } from "next";
import { publicApiClient } from "@/lib/public-api-client";
import type { PublicSitemapEntry } from "@/lib/public-types";

// Server-side only — see the same note in [slug]/page.tsx.
const SITE_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");

/**
 * Phase E4 (docs/KORVA_OS_V2_AUDIT.md §2.6) — real tenant enumeration via the new
 * `GET /public-sites/sitemap-entries` endpoint (PublicSitesController), scoped server-side to
 * `website`-enabled orgs only. Falls back to just the root landing page if the API is
 * unreachable at build/request time, rather than failing the whole sitemap.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const root: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  let entries: PublicSitemapEntry[] = [];
  try {
    entries = await publicApiClient.get<PublicSitemapEntry[]>("/public-sites/sitemap-entries");
  } catch {
    return root;
  }

  const tenantPages: MetadataRoute.Sitemap = entries.map((entry) => ({
    url: `${SITE_URL}/${entry.slug}`,
    lastModified: new Date(entry.updatedAt),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...root, ...tenantPages];
}
