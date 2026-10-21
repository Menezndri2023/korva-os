import type { MetadataRoute } from "next";

// Server-side only — see the same note in [slug]/page.tsx.
const SITE_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");

// Rendered per request: with no dynamic input, Next prerendered this at BUILD time, where
// STOREFRONT_URL is a runtime-only variable — production served "Sitemap: http://localhost:3001/…".
export const dynamic = "force-dynamic";

// The storefront app has no internal/admin routes to exclude — just the landing page ("/") and
// the public tenant pages ("/[slug]"), both of which are meant to be crawled and indexed.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
