import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const isProduction = process.env.NODE_ENV === "production";

const apiOrigin = new URL(
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1",
).origin;

/** The same origin over WebSocket: the kitchen screen receives orders live (socket.io). */
const apiSocketOrigin = apiOrigin.replace(/^http/, "ws");

/** The tenant sites' origin — Settings shows a live preview of the owner's site in an iframe. */
const storefrontOrigin = new URL(
  process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3001",
).origin;

/**
 * Per-request nonce-based CSP, following Next.js's documented pattern
 * (https://nextjs.org/docs/app/guides/content-security-policy): Next's own inline
 * hydration/streaming scripts are automatically nonced once this header is present, so no
 * 'unsafe-inline' is needed for script-src. Built from apps/web's actual dependencies, not a
 * generic template:
 *  - script-src: 'strict-dynamic' + nonce (framework scripts only, no third-party JS anywhere).
 *  - style-src: 'unsafe-inline' is kept because one legitimate dynamic inline `style={{width}}`
 *    exists (dashboard/settings progress bar) — CSP nonces do not apply to style attributes,
 *    only to <style>/<link> elements, so this is the only viable option short of removing that
 *    React pattern. Tailwind's own CSS ships as an external stylesheet, unaffected either way.
 *  - img-src: 'self' + data: + blob: + https:. The dashboard shows photos uploaded to the API
 *    (another origin: api.korvasuite.com), local previews of a file before it is sent (blob:),
 *    and image addresses an owner types in (a logo hosted anywhere). It was 'self' + data: only,
 *    which silently blanked every product photo and logo in the dashboard. Images cannot run
 *    code, so https: here costs no script exposure.
 *  - frame-src: 'self' + the storefront origin — the Settings preview of the owner's own site.
 *    Without it the default-src 'self' applied and the preview stayed blank, although the
 *    storefront's own frame-ancestors allowed the dashboard.
 *  - font-src: 'self' only — next/font/google self-hosts Archivo/IBM Plex Mono at build time, no
 *    runtime request to fonts.googleapis.com/fonts.gstatic.com.
 *  - connect-src: 'self' + the configured API origin — every fetch() call in this app targets
 *    apps/api (NEXT_PUBLIC_API_URL), nothing else.
 *  - unsafe-eval: dev-only. Next.js's webpack dev server (Fast Refresh/HMR) needs it; production
 *    builds never do, so it's never shipped.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isProduction ? "" : " 'unsafe-eval'"}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https: ${apiOrigin}`,
    `frame-src 'self' ${storefrontOrigin}`,
    `font-src 'self'`,
    // + its WebSocket form: the kitchen screen's live feed was blocked until 2026-10-21.
    `connect-src 'self' ${apiOrigin} ${apiSocketOrigin}`,
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
