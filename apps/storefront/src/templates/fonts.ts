/**
 * Maps the logical font names in @korva/types' STOREFRONT_FONT_PAIRINGS to the CSS variables
 * actually loaded once in app/layout.tsx (next/font/google instances live there, not per
 * template, so every template shares the same loaded font files).
 */
export const FONT_VARS: Record<string, string> = {
  geistSans: "var(--font-geist-sans)",
  playfairDisplay: "var(--font-playfair-display)",
  fraunces: "var(--font-fraunces)",
  spaceGrotesk: "var(--font-space-grotesk)",
  poppins: "var(--font-poppins)",
  cormorantGaramond: "var(--font-cormorant-garamond)",
};

export function fontVar(logicalName: string): string {
  return FONT_VARS[logicalName] ?? FONT_VARS.geistSans;
}
