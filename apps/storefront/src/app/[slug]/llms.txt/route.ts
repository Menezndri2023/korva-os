import { fetchOrganization } from "@/lib/fetch-organization";
import { serverApi } from "@/lib/server-api";
import { siteLlmsText } from "@/lib/site-llms";
import type { PublicOffer } from "@/lib/public-types";

// Server-side only — see the same note in ../page.tsx.
const SITE_URL = (process.env.STOREFRONT_URL ?? "http://localhost:3001").replace(/\/$/, "");

export const dynamic = "force-dynamic";

/** /<slug>/llms.txt — the business, for AI assistants (lib/site-llms.ts). */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const lookup = await fetchOrganization(slug);
  if (lookup.kind !== "found") {
    return new Response(lookup.kind === "absent" ? "Not found\n" : "Temporarily unavailable\n", {
      status: lookup.kind === "absent" ? 404 : 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const { organization } = lookup;
  // Only what the site itself shows: a hidden catalogue stays hidden here too.
  const offers = organization.visibleSections.includes("catalog")
    ? await serverApi.get<PublicOffer[]>(`/public/${slug}/offers`).catch(() => [] as PublicOffer[])
    : [];
  return new Response(siteLlmsText(organization, offers, `${SITE_URL}/${slug}`), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
