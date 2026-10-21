import type { MetadataRoute } from "next";
import { serverApi } from "@/lib/server-api";
import type { PublicSitemapEntry } from "@/lib/public-types";

// Server-side only — see the same note in [slug]/page.tsx.
const SITE_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");

/**
 * Phase E4 (docs/KORVA_OS_V2_AUDIT.md §2.6) — real tenant enumeration via the new
 * `GET /public-sites/sitemap-entries` endpoint (PublicSitesController), scoped server-side to
 * `website`-enabled orgs only. Empty rather than failing if the API is unreachable.
 *
 * The root of this domain is not listed: it redirects to KORVA's home page (see app/page.tsx),
 * and a sitemap must only name pages that answer 200 themselves.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let entries: PublicSitemapEntry[] = [];
  try {
    entries = await serverApi.get<PublicSitemapEntry[]>("/public-sites/sitemap-entries");
  } catch {
    return [];
  }

  const tenantPages: MetadataRoute.Sitemap = entries.map((entry) => ({
    url: `${SITE_URL}/${entry.slug}`,
    lastModified: new Date(entry.updatedAt),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return tenantPages;
}
