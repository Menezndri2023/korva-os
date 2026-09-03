import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";
import "./globals.css";
import { Providers } from "./providers";

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

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KORVA OS",
  description: "Business Operating System pour PME et indépendants.",
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
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
