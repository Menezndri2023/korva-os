import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Playfair_Display,
  Fraunces,
  Space_Grotesk,
  Poppins,
  Cormorant_Garamond,
} from "next/font/google";
import "./globals.css";
import { ErrorReporter } from "@korva/ui";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Heading fonts for the storefront template system (see src/templates/fonts.ts) — loaded once
// here so every template can reference their CSS variables without loading fonts per-component.
const playfairDisplay = Playfair_Display({
  variable: "--font-playfair-display",
  subsets: ["latin"],
});
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
});
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
});
// The premium "Prestige" pairing (Pro).
const cormorantGaramond = Cormorant_Garamond({
  variable: "--font-cormorant-garamond",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});
const poppins = Poppins({
  variable: "--font-poppins",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "KORVA OS — Storefront",
  description: "Boutique et réservation en ligne propulsées par KORVA OS.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable} ${fraunces.variable} ${spaceGrotesk.variable} ${poppins.variable} ${cormorantGaramond.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ErrorReporter
          endpoint={`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1"}/client-errors`}
          app="storefront"
        />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
