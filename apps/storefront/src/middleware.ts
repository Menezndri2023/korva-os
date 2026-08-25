import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isProduction = process.env.NODE_ENV === "production";

const apiOrigin = new URL(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1",
).origin;

/**
 * Per-request nonce-based CSP, following Next.js's documented pattern
 * (https://nextjs.org/docs/app/guides/content-security-policy). Deliberately NOT copied from
 * apps/web — the storefront's real usage is checked independently:
 *  - script-src: 'strict-dynamic' + nonce, no third-party JS anywhere in this app.
 *  - style-src: 'self' only (no 'unsafe-inline') — unlike apps/web, this app has zero
 *    `style={{...}}` usage today (confirmed by search), so it can be stricter.
 *  - img-src: 'self' + data: + https: — the storefront now renders offer.images (Wave 2 Agent F,
 *    catalog thumbnails + the offer detail page). Organization.logo is deliberately still not
 *    rendered in the UI this wave (tenant branding is a cross-agent dependency, see this wave's
 *    report). apps/api has no image upload/storage feature yet (grepped: no S3/CDN/media
 *    module, only unused STORAGE_* env placeholders), so offer.images entries are arbitrary
 *    tenant-supplied strings with no fixed host to allow-list. 'https:' is the narrowest
 *    directive that still works against an unknown host; tighten this to a specific CDN/bucket
 *    domain once apps/api actually ships one.
 *  - font-src: 'self' only — next/font/google self-hosts Geist/Geist Mono at build time.
 *  - connect-src: 'self' + the configured API origin — every fetch() call targets
 *    apps/api's public endpoints (NEXT_PUBLIC_API_URL), nothing else.
 *  - unsafe-eval: dev-only, for Next.js's webpack dev server (Fast Refresh/HMR); never shipped
 *    to production.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    `style-src 'self'`,
    `img-src 'self' data: https:`,
    `font-src 'self'`,
    `connect-src 'self' ${apiOrigin}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isProduction ? [`upgrade-insecure-requests`] : []),
  ];
  const csp = directives.join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
