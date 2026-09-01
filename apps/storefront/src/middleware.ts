import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isProduction = process.env.NODE_ENV === "production";

const apiOrigin = new URL(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1",
).origin;

// Narrow, deliberate carve-out from a stricter `frame-ancestors 'none'`: Settings' storefront
// preview (apps/web dashboard/settings) embeds this app in an iframe so an owner can check a
// change without leaving Settings — allow-listing exactly that one first-party origin (never a
// wildcard, never third-party) keeps the real threat this directive defends against (an
// arbitrary attacker-controlled page framing a checkout-capable storefront for clickjacking)
// fully blocked, since APP_URL is operator-configured infrastructure, not tenant/user input.
const dashboardOrigin = new URL(process.env.APP_URL ?? "http://localhost:3000").origin;

/**
 * Per-request nonce-based CSP, following Next.js's documented pattern
 * (https://nextjs.org/docs/app/guides/content-security-policy). Deliberately NOT copied from
 * apps/web — the storefront's real usage is checked independently:
 *  - script-src: 'strict-dynamic' + nonce, no third-party JS anywhere in this app.
 *  - style-src: 'self' plus this request's nonce — the storefront template system
 *    (src/templates/) renders one nonce'd `<style>` tag per page holding an organization's
 *    resolved theme as CSS custom properties (`--kt-*`; see templates/storefront-theme-style.tsx),
 *    which every template then only ever reads via static Tailwind classes
 *    (`bg-[var(--kt-accent)]`, never a React `style={{...}}` prop) — so no `'unsafe-inline'` and
 *    no per-element inline style is ever needed despite per-tenant theming.
 *  - img-src: 'self' + data: + https: — the storefront renders offer.images, Organization.logo/
 *    heroImage, and other tenant-supplied image URLs. apps/api's upload endpoint
 *    (POST /uploads, apps/shared/storage) stores files under its own domain, but a tenant can
 *    still type an arbitrary external image URL into any of these fields — there is no single
 *    fixed host to allow-list. 'https:' is the narrowest directive that still works against an
 *    unknown host.
 *  - font-src: 'self' only — next/font/google self-hosts Geist/Geist Mono at build time.
 *  - connect-src: 'self' + the configured API origin — every fetch() call targets
 *    apps/api's public endpoints (NEXT_PUBLIC_API_URL), nothing else.
 *  - frame-ancestors: 'self' + the dashboard's own origin (APP_URL) — see the dedicated comment
 *    on `dashboardOrigin` above for why this one first-party carve-out is safe.
 *  - unsafe-eval: dev-only, for Next.js's webpack dev server (Fast Refresh/HMR); never shipped
 *    to production.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data: https:`,
    `font-src 'self'`,
    `connect-src 'self' ${apiOrigin}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'self' ${dashboardOrigin}`,
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
