import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree, IBM_Plex_Mono } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import { ErrorReporter } from "@korva/ui";
import { Providers } from "./providers";
import { BRAND_KEYWORDS_FR, BRAND_NAME, HOME_DESCRIPTION_FR, HOME_TITLE_FR, PUBLISHER } from "@/lib/brand";

/**
 * Runs synchronously before the body ever paints — reads the visitor's stored theme choice (or
 * leaves data-theme unset, so the prefers-color-scheme media query in packages/ui/tokens.css
 * takes over) and applies it to <html> immediately. Without this, ThemeProvider's own
 * (necessarily client-side, post-mount) read of localStorage would apply one paint late,
 * flashing the wrong theme on every load for anyone who explicitly chose dark. Needs the
 * request's CSP nonce (middleware.ts: script-src has no 'unsafe-inline') to be allowed to run
 * at all — see that file's own doc comment.
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('korva-theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

/**
 * The V3 identity (2026-10-21, "chaleureux et coloré"): Figtree for everything people read and
 * type — open, rounded and very legible at small sizes on a phone — and Bricolage Grotesque for
 * headings only, whose ink traps and slightly irregular widths give titles the warmth the
 * request asked for without turning body text into a display face. Both are variable fonts on
 * Google Fonts, so no `weight` array.
 *
 * `latin-ext` is not optional for a French-language product: the `latin` subset alone omits the
 * oe ligature in "oeuvre"/"voeux", which would silently fall back to a different face mid-word.
 *
 * Deliberately NOT changed: apps/storefront's fonts. All tenant font pairings in
 * packages/types/src/storefront-themes.ts set the body face, so swapping it there would restyle
 * every tenant site already published. KORVA's own identity stops at KORVA's own pages.
 */
const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

/**
 * Figures only — prices, counts, anything that belongs in an aligned column, where proportional
 * digits make rows fail to line up. Never used for labels or headings: a monospace face applied
 * to small text as decoration is its own cliche, and it is slower to read than the body face.
 * Unlike Archivo this is not a variable font, so the two weights actually used are declared.
 */
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/**
 * `/` is a public marketing page now, not a redirect, so this metadata is what search results
 * and link previews actually show. The description is written for the owner who would buy this
 * ("Business Operating System pour PME et indépendants" was written for an investor), and
 * `template` keeps the brand on every nested route's title without repeating it per page.
 */
export const metadata: Metadata = {
  // Absolute base for canonical links and the share image. The production address; APP_URL
  // (server-side, see lib/site-url.ts) is what the sitemap and robots.txt use.
  metadataBase: new URL(process.env.APP_URL ?? "https://app.korvasuite.com"),
  twitter: { card: "summary_large_image" },
  // Brand first, then the words people actually search ("logiciel de gestion", "site internet"):
  // see lib/brand.ts for why the alternate names live in the structured data too.
  title: {
    default: HOME_TITLE_FR,
    template: "%s · KORVA OS",
  },
  description: HOME_DESCRIPTION_FR,
  applicationName: BRAND_NAME,
  keywords: BRAND_KEYWORDS_FR,
  creator: PUBLISHER.name,
  publisher: PUBLISHER.name,
  // Google Search Console ownership of https://app.korvasuite.com (public, not a secret).
  verification: { google: "gcyX2n6EYn4ip0teMka5Xc27liad23u4i11hOGj5vQ8" },
  openGraph: {
    type: "website",
    siteName: BRAND_NAME,
    locale: "fr_FR",
    title: HOME_TITLE_FR,
    description:
      "Votre cahier, votre carnet de rendez-vous et votre caisse au même endroit. " +
      "Choisissez votre métier, votre espace est déjà configuré.",
  },
};

// Every route in this app is force-dynamic for one reason: middleware.ts issues a fresh CSP
// nonce per request, but Next only threads that nonce into the <script> tags it renders when
// the route is actually rendered per-request — a statically prerendered route (the default
// here, since no route reads a dynamic API) is rendered once at build time, when no request
// (and so no nonce) exists yet, so its cached HTML ships scripts with no nonce at all. Under
// the 'strict-dynamic' CSP in middleware.ts, an un-nonced script is never allowed to run,
// which blocked every script on every page in production and prevented React from ever
// hydrating (see Bug #2 CSP audit). Every route here is already a "use client" interactive
// app (no static/marketing pages), so scoping this any narrower than the root layout would
// just repeat it on every route for the same outcome.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  // Set by middleware.ts from the path: "en" under /en.
  const lang = requestHeaders.get("x-korva-lang") === "en" ? "en" : "fr";
  return (
    <html
      lang={lang}
      className={`${figtree.variable} ${bricolage.variable} ${plexMono.variable} h-full antialiased`}
      // data-theme is set by THEME_INIT_SCRIPT below, outside React's own render — without this,
      // React would warn (or in dev, error) about a server/client attribute mismatch on <html>.
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-app-background text-text">
        {/* beforeInteractive: Next extracts this out of the normal React tree and injects it
            into the initial HTML document's <head> directly, executing it before hydration —
            unlike a plain <script> tag rendered via JSX, this never re-triggers (or warns about
            being inert) on a later client-side navigation. */}
        <Script id="theme-init" strategy="beforeInteractive" nonce={nonce}>
          {THEME_INIT_SCRIPT}
        </Script>
        <ErrorReporter
          endpoint={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1"}/client-errors`}
          app="web"
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
