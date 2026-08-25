import type { MetadataRoute } from "next";

// Server-side only — see the same note in [slug]/page.tsx.
const SITE_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");

/**
 * BACKEND CONTRACT REQUIRED: this storefront has no way to list per-tenant sitemap entries
 * today. apps/api's public API (apps/api/src/public/public.controller.ts) is entirely scoped
 * to a single already-known :organizationSlug — every route requires the slug as input, and
 * there is no "list organizations" endpoint to enumerate the slugs that exist. Until such an
 * endpoint is added (out of scope here — apps/api is off-limits for this lot), this sitemap can
 * only list the route(s) the storefront owns outright, i.e. the root landing page.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
