import { INDEXNOW_KEY } from "@korva/types";

/** /indexnow.txt — proves this host's ownership to IndexNow (packages/types/src/seo.ts). */
export function GET() {
  return new Response(INDEXNOW_KEY, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}
