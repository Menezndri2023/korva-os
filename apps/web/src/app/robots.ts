import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/site-url";

/** Accounts, administration and one-time links: nothing a search result should ever lead to. */
const PRIVATE = ["/dashboard", "/admin", "/onboarding", "/voir", "/invitations", "/reset-password", "/verify-email", "/platform"];

/** Public pages are open to search engines and AI crawlers; accounts and the administration are not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Named on purpose: the search and answer engines people now ask for "un logiciel de
      // gestion". Some hosts and CDNs block these by default; this says KORVA wants them in.
      {
        userAgent: [
          "Googlebot",
          "Bingbot",
          "GPTBot",
          "OAI-SearchBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-SearchBot",
          "PerplexityBot",
          "Google-Extended",
          "Applebot",
        ],
        allow: ["/", "/metiers", "/llms.txt"],
        disallow: PRIVATE,
      },
      {
        userAgent: "*",
        allow: ["/", "/metiers"],
        disallow: PRIVATE,
      },
    ],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
