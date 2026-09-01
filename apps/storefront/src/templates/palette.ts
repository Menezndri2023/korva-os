import { STOREFRONT_PALETTES, STOREFRONT_FONT_PAIRINGS, type StorefrontTheme } from "@korva/types";
import { fontVar } from "./fonts";

/** Resolved, ready-to-use hex values + font CSS vars for one organization's storefront. */
export interface ResolvedStorefrontStyle {
  background: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentContrast: string;
  headingFont: string;
  bodyFont: string;
}

const ESSENTIEL_BASE = {
  background: "#ffffff",
  surface: "#ffffff",
  border: "#e4e4e7",
  text: "#18181b",
  textMuted: "#71717a",
  accentContrast: "#ffffff",
};

/**
 * `theme.template === "essentiel"` has no palette (see StorefrontTemplateDefinition.palettes —
 * empty for it): falls back to the plain neutral look apps/storefront always had, with
 * `brandColor` as the sole accent override, exactly like the pre-template-system behavior.
 */
export function resolveStorefrontStyle(
  theme: StorefrontTheme,
  brandColor: string | undefined,
): ResolvedStorefrontStyle {
  const fontPairing = STOREFRONT_FONT_PAIRINGS[theme.fontPairing];
  const fonts = {
    headingFont: fontVar(fontPairing.headingFont),
    bodyFont: fontVar(fontPairing.bodyFont),
  };

  if (!theme.palette) {
    return {
      ...ESSENTIEL_BASE,
      accent: brandColor || ESSENTIEL_BASE.text,
      ...fonts,
    };
  }

  const base = STOREFRONT_PALETTES[theme.palette];
  return {
    background: base.background,
    surface: base.surface,
    border: base.border,
    text: base.text,
    textMuted: base.textMuted,
    accent: theme.customAccentApplied && brandColor ? brandColor : base.accent,
    accentContrast: base.accentContrast,
    ...fonts,
  };
}
