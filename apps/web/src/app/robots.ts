import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/site-url";

/** Public pages are open to search engines and AI crawlers; accounts and the administration are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/metiers"],
        disallow: ["/dashboard", "/admin", "/onboarding", "/voir", "/invitations", "/reset-password", "/verify-email", "/platform"],
      },
    ],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
