import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isProduction = process.env.NODE_ENV === "production";

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1").replace(
  /\/$/,
  "",
);
const apiOrigin = new URL(API_BASE_URL).origin;

// Phase E3 (docs/KORVA_OS_V2_AUDIT.md §2.6) — the platform's own shared storefront host
// (`{STOREFRONT_URL}/{slug}`). Any request whose `Host` header differs from this is either a
// connected custom domain or DNS pointed here by mistake — see resolveCustomDomain below.
const platformHost = new URL(process.env.STOREFRONT_URL ?? "http://localhost:3001").host;

/**
 * Resolves an incoming custom-domain `Host` header to the owning org's slug via the API,
 * cached 5 minutes through Next's fetch Data Cache — Proxy defaults to the Node.js runtime in
 * this Next.js version (see node_modules/next/dist/docs/.../proxy.md "Runtime" section), so an
 * ordinary `fetch()` here participates in the same cache as a Server Component's would. Returns
 * null on any failure (unknown domain, API unreachable) so the caller can fall through to
 * normal routing rather than breaking the request.
 */
async function resolveCustomDomain(host: string): Promise<string | null> {
  try {
    const response = await fetch(
      // On the private network when configured (see lib/server-api.ts), like every other call the
      // storefront server makes.
      `${process.env.API_INTERNAL_URL ?? API_BASE_URL}/public-sites/resolve-domain?host=${encodeURIComponent(host)}`,
      { next: { revalidate: 300 } },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      success: boolean;
      data?: { slug: string };
    };
    return payload.success ? (payload.data?.slug ?? null) : null;
  } catch {
    return null;
  }
}

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
export async function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    `style-src 'self' 'nonce-${nonce}'`,
    // + the API origin explicitly: uploads are served from it, and over plain http in development.
    `img-src 'self' data: https: ${apiOrigin}`,
    `font-src 'self'`,
    // Google Analytics and Meta Pixel send their hits here — only after the visitor's consent,
    // on Pro sites that set an id (app/[slug]/site-tracking.tsx). Their scripts need no entry:
    // 'strict-dynamic' trusts what the nonce'd bundle loads.
    `connect-src 'self' ${apiOrigin} https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://www.facebook.com`,
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

  // Phase E3 — transparently rewrite a connected custom domain's request onto the existing
  // /[slug]/... route tree, keeping the custom domain in the visitor's address bar (a rewrite,
  // never a redirect). A request already on the platform's own shared host is untouched.
  const hostHeader = request.headers.get("host") ?? "";
  if (hostHeader && hostHeader !== platformHost) {
    const slug = await resolveCustomDomain(hostHeader);
    if (slug) {
      const rewrittenUrl = request.nextUrl.clone();
      rewrittenUrl.pathname =
        rewrittenUrl.pathname === "/" ? `/${slug}` : `/${slug}${rewrittenUrl.pathname}`;
      const response = NextResponse.rewrite(rewrittenUrl, {
        request: { headers: requestHeaders },
      });
      response.headers.set("Content-Security-Policy", csp);
      return response;
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
