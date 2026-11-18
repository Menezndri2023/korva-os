/**
 * PLAN_KEYS, PLAN_RANK and planMeetsMinimum used to be declared here, with a comment instructing
 * whoever edited them to also edit PlansService.DEFAULT_PLANS by hand. They now live in
 * plan-tiers.ts together with the module thresholds, limits and prices they describe — see that
 * file for what the split was costing. Imported rather than re-exported: index.ts exports both
 * modules with `export *`, so re-exporting them here would be a duplicate export of the same
 * name. Every consumer reads them from "@korva/types" and is unaffected.
 */
import { planMeetsMinimum, type PlanKey } from "./plan-tiers.ts";

/**
 * Storefront visual template system — lets each organization's public site (apps/storefront)
 * look like a real, purpose-built site for its sector instead of one generic layout with a
 * single accent color. Purely presentational: choosing a template/palette/fontPairing never
 * changes what data is shown or what actions are possible, only how the same data renders (see
 * apps/storefront/src/templates/).
 *
 * Distinctness across owners in the same sector comes from three independent axes — template
 * (fixed per sector by default, changeable), palette (3 options per template) and font pairing
 * (2 options per template) — combined with a deterministic-but-varied default pick (see
 * PublicService in apps/api, which hashes the organization id) so two brand-new same-sector
 * organizations don't default to an identical look even before either owner customizes anything.
 */
export const STOREFRONT_TEMPLATE_KEYS = [
  "essentiel",
  "vitrine",
  "table",
  "boutique",
  "academie",
  "salon",
  "sejour",
  "agence",
] as const;
export type StorefrontTemplateKey = (typeof STOREFRONT_TEMPLATE_KEYS)[number];

export const STOREFRONT_PALETTE_KEYS = [
  "graphite",
  "ardoise",
  "terracotta",
  "sauge",
  "corail",
  "marine",
  "indigo",
  "ocre",
  // Premium (Pro, every sector template) — see PREMIUM_PALETTE_KEYS.
  "ivoire",
  "jade",
  "bordeaux",
] as const;
export type StorefrontPaletteKey = (typeof STOREFRONT_PALETTE_KEYS)[number];

export interface StorefrontPalette {
  key: StorefrontPaletteKey;
  label: string;
  background: string;
  surface: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentContrast: string;
}

export const STOREFRONT_PALETTES: Record<StorefrontPaletteKey, StorefrontPalette> = {
  graphite: {
    key: "graphite",
    label: "Graphite",
    background: "#FAFAF9",
    surface: "#FFFFFF",
    border: "#E7E5E4",
    text: "#1C1917",
    textMuted: "#78716C",
    accent: "#1C1917",
    accentContrast: "#FFFFFF",
  },
  ardoise: {
    key: "ardoise",
    label: "Ardoise",
    background: "#0F172A",
    surface: "#1E293B",
    border: "#334155",
    text: "#F1F5F9",
    textMuted: "#94A3B8",
    accent: "#D4A94A",
    accentContrast: "#1F2937",
  },
  terracotta: {
    key: "terracotta",
    label: "Terracotta",
    background: "#FDF6EC",
    surface: "#FFFFFF",
    border: "#E8DCC8",
    text: "#3A2E1F",
    textMuted: "#8A7A63",
    accent: "#C1622D",
    accentContrast: "#FFFFFF",
  },
  sauge: {
    key: "sauge",
    label: "Sauge",
    background: "#F4F7F1",
    surface: "#FFFFFF",
    border: "#DCE5D3",
    text: "#263826",
    textMuted: "#6B7C63",
    accent: "#4B6A45",
    accentContrast: "#FFFFFF",
  },
  corail: {
    key: "corail",
    label: "Corail",
    background: "#FFF7F5",
    surface: "#FFFFFF",
    border: "#F4D9D2",
    text: "#3A2420",
    textMuted: "#9C7B73",
    accent: "#E1604A",
    accentContrast: "#FFFFFF",
  },
  marine: {
    key: "marine",
    label: "Marine",
    background: "#F7F5EF",
    surface: "#FFFFFF",
    border: "#DAD3C0",
    text: "#1B2430",
    textMuted: "#6E7686",
    accent: "#1F3A5F",
    accentContrast: "#FFFFFF",
  },
  indigo: {
    key: "indigo",
    label: "Indigo",
    background: "#F5F5FF",
    surface: "#FFFFFF",
    border: "#DCDCF5",
    text: "#1E1B4B",
    textMuted: "#6B67A6",
    accent: "#4338CA",
    accentContrast: "#FFFFFF",
  },
  ocre: {
    key: "ocre",
    label: "Ocre",
    background: "#FBF8F1",
    surface: "#FFFFFF",
    border: "#E6DEC7",
    text: "#2E2A1E",
    textMuted: "#857A5E",
    accent: "#B08A2E",
    accentContrast: "#FFFFFF",
  },
  ivoire: {
    key: "ivoire",
    label: "Ivoire et or",
    background: "#FBF8F1",
    surface: "#FFFFFF",
    border: "#E9DFC8",
    text: "#26221A",
    textMuted: "#7A6F58",
    accent: "#9A7524",
    accentContrast: "#FFFFFF",
  },
  jade: {
    key: "jade",
    label: "Jade",
    background: "#F5F8F4",
    surface: "#FFFFFF",
    border: "#D5E2DA",
    text: "#14281F",
    textMuted: "#5A7266",
    accent: "#1E6A57",
    accentContrast: "#FFFFFF",
  },
  bordeaux: {
    key: "bordeaux",
    label: "Bordeaux",
    background: "#FBF6F5",
    surface: "#FFFFFF",
    border: "#EBD9D7",
    text: "#2A1618",
    textMuted: "#7C5F62",
    accent: "#7A2236",
    accentContrast: "#FFFFFF",
  },
};

export const STOREFRONT_FONT_PAIRING_KEYS = [
  "sobre",
  "editorial",
  "chaleureux",
  "geometrique",
  "arrondi",
  // Premium (Pro) — see PREMIUM_FONT_PAIRING_KEYS.
  "prestige",
] as const;
export type StorefrontFontPairingKey = (typeof STOREFRONT_FONT_PAIRING_KEYS)[number];

/**
 * `headingFont`/`bodyFont` are logical names, mapped to actual next/font/google loaders in
 * apps/storefront/src/templates/fonts.ts (this package stays framework-agnostic).
 */
export interface StorefrontFontPairing {
  key: StorefrontFontPairingKey;
  label: string;
  headingFont: string;
  bodyFont: string;
}

export const STOREFRONT_FONT_PAIRINGS: Record<StorefrontFontPairingKey, StorefrontFontPairing> = {
  sobre: { key: "sobre", label: "Sobre", headingFont: "geistSans", bodyFont: "geistSans" },
  editorial: { key: "editorial", label: "Éditorial", headingFont: "playfairDisplay", bodyFont: "geistSans" },
  chaleureux: { key: "chaleureux", label: "Chaleureux", headingFont: "fraunces", bodyFont: "geistSans" },
  geometrique: { key: "geometrique", label: "Géométrique", headingFont: "spaceGrotesk", bodyFont: "geistSans" },
  arrondi: { key: "arrondi", label: "Arrondi", headingFont: "poppins", bodyFont: "geistSans" },
  prestige: { key: "prestige", label: "Prestige", headingFont: "cormorantGaramond", bodyFont: "geistSans" },
};

export interface StorefrontTemplateDefinition {
  key: StorefrontTemplateKey;
  label: string;
  description: string;
  /**
   * Minimum plan required to select this template at all (see
   * EntitlementsService.assertStorefrontThemeAllowed).
   *
   * Every sector template was "starter" until 2026-10-13, while all seventeen VERTICAL_TEMPLATES
   * default to one of them — so a free organization always fell back to "essentiel" and the
   * seventeen trades rendered one identical generic site. The public page is the free plan's
   * whole visible output, seen by the customer's own customers, so that was the worst possible
   * place to economise. Paid visual differentiation stays where it already was and is already
   * enforced: `refinedChoiceMinPlan` (choose a palette and font pairing) and
   * `customAccentMinPlan` (your own brand colour). A free organization gets its sector's
   * template on the template's first preset.
   */
  minPlan: PlanKey;
  /** Empty for "essentiel", which uses `organization.brandColor` directly instead of a palette. */
  palettes: StorefrontPaletteKey[];
  fontPairings: StorefrontFontPairingKey[];
  /** Minimum plan required to pick anything beyond `palettes[0]`/`fontPairings[0]`. */
  refinedChoiceMinPlan: PlanKey;
  /** Minimum plan required for `organization.brandColor` to override the palette's accent color. */
  customAccentMinPlan: PlanKey;
}

export const STOREFRONT_TEMPLATES: StorefrontTemplateDefinition[] = [
  {
    key: "essentiel",
    label: "Essentiel",
    description: "Gabarit universel, sobre — disponible sur tous les abonnements.",
    minPlan: "free",
    palettes: [],
    fontPairings: ["sobre"],
    refinedChoiceMinPlan: "free",
    customAccentMinPlan: "free",
  },
  {
    key: "vitrine",
    label: "Vitrine services",
    description: "Services professionnels, artisanat & BTP, agences, associations, événementiel.",
    minPlan: "free",
    palettes: ["graphite", "sauge", "ocre"],
    fontPairings: ["sobre", "editorial"],
    refinedChoiceMinPlan: "pro",
    customAccentMinPlan: "business",
  },
  {
    key: "table",
    label: "Table",
    description: "Restauration, hôtellerie légère, traiteur.",
    minPlan: "free",
    palettes: ["ardoise", "terracotta", "ocre"],
    fontPairings: ["chaleureux", "sobre"],
    refinedChoiceMinPlan: "pro",
    customAccentMinPlan: "business",
  },
  {
    key: "boutique",
    label: "Boutique",
    description: "Commerce & e-commerce, mode, épicerie/alimentation, agriculture & vente directe.",
    minPlan: "free",
    palettes: ["marine", "corail", "graphite"],
    fontPairings: ["geometrique", "sobre"],
    refinedChoiceMinPlan: "pro",
    customAccentMinPlan: "business",
  },
  {
    key: "academie",
    label: "Académie",
    description: "Formation, coaching, ateliers.",
    minPlan: "free",
    palettes: ["indigo", "sauge", "marine"],
    fontPairings: ["arrondi", "sobre"],
    refinedChoiceMinPlan: "pro",
    customAccentMinPlan: "business",
  },
  {
    key: "salon",
    label: "Salon",
    description: "Beauté & bien-être, santé non médicale, sport & fitness, garde d'enfants & services à la personne — réservation au premier plan.",
    minPlan: "free",
    palettes: ["corail", "sauge", "ardoise"],
    fontPairings: ["editorial", "arrondi"],
    refinedChoiceMinPlan: "pro",
    customAccentMinPlan: "business",
  },
  {
    key: "sejour",
    label: "Séjour",
    description: "Hôtels, gîtes, chambres d'hôtes — les chambres en grand, capacité et équipements, prix à la nuit.",
    minPlan: "free",
    palettes: ["sauge", "terracotta", "marine"],
    fontPairings: ["editorial", "chaleureux"],
    refinedChoiceMinPlan: "pro",
    customAccentMinPlan: "business",
  },
  {
    key: "agence",
    label: "Agence immobilière",
    description: "Agences, gestion locative — annonces filtrables par vente ou location, type de bien, quartier, prix et surface.",
    minPlan: "free",
    palettes: ["graphite", "marine", "ocre"],
    fontPairings: ["sobre", "geometrique"],
    refinedChoiceMinPlan: "pro",
    customAccentMinPlan: "business",
  },
];

/**
 * Premium site themes (Pro, 2026-11-01): palettes and a font pairing offered on EVERY sector
 * template on top of its own, for a site that does not look like the sector's default. Never
 * part of the default pick (PublicService.pickDeterministic draws from the template's own lists),
 * so no existing site changes colour on its own — only an owner choosing one applies it.
 * "essentiel" has no palettes (it uses the brand colour) and gets none.
 */
export const PREMIUM_PALETTE_KEYS: readonly StorefrontPaletteKey[] = ["ivoire", "jade", "bordeaux"];
export const PREMIUM_FONT_PAIRING_KEYS: readonly StorefrontFontPairingKey[] = ["prestige"];
export const PREMIUM_THEME_MIN_PLAN: PlanKey = "pro";

/** Every palette an organization on `planKey` may choose for this template. */
export function selectablePalettes(
  template: StorefrontTemplateDefinition,
  planKey: string,
): StorefrontPaletteKey[] {
  const own = planMeetsMinimum(planKey, template.refinedChoiceMinPlan)
    ? template.palettes
    : template.palettes.slice(0, 1);
  const premium =
    template.palettes.length > 0 && planMeetsMinimum(planKey, PREMIUM_THEME_MIN_PLAN)
      ? PREMIUM_PALETTE_KEYS
      : [];
  return [...own, ...premium];
}

/** Every font pairing an organization on `planKey` may choose for this template. */
export function selectableFontPairings(
  template: StorefrontTemplateDefinition,
  planKey: string,
): StorefrontFontPairingKey[] {
  const own = planMeetsMinimum(planKey, template.refinedChoiceMinPlan)
    ? template.fontPairings
    : template.fontPairings.slice(0, 1);
  const premium =
    template.palettes.length > 0 && planMeetsMinimum(planKey, PREMIUM_THEME_MIN_PLAN)
      ? PREMIUM_FONT_PAIRING_KEYS
      : [];
  return [...own, ...premium];
}

export function getStorefrontTemplate(key: string): StorefrontTemplateDefinition {
  return (
    STOREFRONT_TEMPLATES.find((t) => t.key === key) ??
    STOREFRONT_TEMPLATES.find((t) => t.key === "essentiel")!
  );
}

export interface StorefrontTheme {
  template: StorefrontTemplateKey;
  /** Absent only for "essentiel", which has no palette system. */
  palette?: StorefrontPaletteKey;
  fontPairing: StorefrontFontPairingKey;
  /** Whether `organization.brandColor` should override the palette's accent — true once the
   *  organization's plan meets the template's `customAccentMinPlan` AND brandColor is set. */
  customAccentApplied: boolean;
}

/**
 * Deterministic pick from a non-empty list, stable per organization — so two organizations
 * defaulting to the same template still diverge (different palette/font) without either owner
 * having to choose anything. Not cryptographic; just needs to be stable and roughly uniform.
 */
export function pickDeterministic<T>(seed: string, options: readonly T[]): T {
  if (options.length === 0) {
    throw new Error("pickDeterministic requires a non-empty options list");
  }
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return options[hash % options.length] as T;
}
