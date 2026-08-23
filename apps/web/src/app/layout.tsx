import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
