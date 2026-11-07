import { z } from "zod";
import {
  ACQUISITION_SOURCES,
  BUSINESS_MODELS,
  TRADE_TOOLS,
  FULFILLMENT_MODES,
  KORVA_MODULES,
  PAYMENT_METHODS,
  STOREFRONT_SECTIONS,
  STOREFRONT_TEMPLATE_KEYS,
  STOREFRONT_PALETTE_KEYS,
  STOREFRONT_FONT_PAIRING_KEYS,
} from "@korva/types";

export const createOrganizationSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(60),
  /** Type of activity (business-models.ts). Optional: when omitted at creation the API derives
   *  it from a recognised trade in `type`, and leaves it unset otherwise. */
  businessModel: z.enum(BUSINESS_MODELS).optional(),
  country: z.string().length(2),
  currency: z.string().length(3),
  timezone: z.string().min(1),
  language: z.string().min(2).max(10).default("fr"),
  /** Phase E2 (docs/KORVA_OS_V2_AUDIT.md §2.6) — an optional onboarding-only free-text
   *  description of the org's own products/services, in the owner's own words. Never stored
   *  verbatim as its own field: OrganizationsService.createForOwner uses it, once, to seed the
   *  real `tagline`/`aboutText` storefront content fields at creation time — the same
   *  content-slot fields Settings already lets an owner edit by hand, just pre-filled with
   *  genuinely entered data instead of left blank. */
  businessDescription: z.string().min(1).max(2000).optional(),
  /** "Comment avez-vous connu KORVA ?" (growth.ts). */
  acquisitionSource: z.enum(ACQUISITION_SOURCES).optional(),
  /** The referring business's code, from a parrainage link (growth.ts). Unknown codes are ignored. */
  referralCode: z.string().trim().max(20).optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

/** Onboarding's "importer mon entreprise" step — fetches this URL server-side and extracts
 *  best-effort branding suggestions (name/tagline/logo) the user reviews before creating the
 *  organization. https-only, same posture as webhook URLs (see assertSafeWebhookUrl). */
export const importOrganizationPreviewSchema = z.object({
  url: z.string().url(),
});
export type ImportOrganizationPreviewInput = z.infer<
  typeof importOrganizationPreviewSchema
>;

const deliveryZoneSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  fee: z.number().nonnegative(),
  minimumOrder: z.number().nonnegative().optional(),
});

/** e.g. "#1a73e8" or "#fff" — a single storefront accent color, deliberately not a full theme. */
const hexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a hex color, e.g. #1a73e8');

/** Storefront content sections (Pro plan and above) — see
 *  EntitlementsService.assertContentSectionsAllowed. Whole-array-replace, not per-item CRUD:
 *  the frontend generates `id` client-side (e.g. crypto.randomUUID()) when adding a new item. */
const testimonialSchema = z.object({
  id: z.string().min(1),
  authorName: z.string().min(1).max(120),
  role: z.string().max(120).optional(),
  quote: z.string().min(1).max(1000),
  rating: z.number().min(1).max(5).optional(),
});

const teamMemberSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  photo: z.string().url().optional(),
  bio: z.string().max(1000).optional(),
});

const galleryImageSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  caption: z.string().max(200).optional(),
});

const faqItemSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1).max(300),
  answer: z.string().min(1).max(2000),
});

export const updateOrganizationSchema = createOrganizationSchema.partial().extend({
  legalName: z.string().max(200).optional(),
  logo: z.string().url().optional(),
  brandColor: hexColorSchema.optional(),
  /** Short pitch shown under the org name in the public storefront hero. */
  tagline: z.string().max(200).optional(),
  /** Wide banner image for the storefront hero, distinct from `logo`. */
  heroImage: z.string().url().optional(),
  /** Public contact details shown on the site, every plan. "" clears a value. */
  contactPhone: z.string().trim().max(30).optional(),
  /** International format, so the site can build a wa.me link — a local number ("07 07…") has
   *  no country code and WhatsApp cannot resolve it. */
  whatsappNumber: z
    .union([
      z.literal(""),
      z
        .string()
        .trim()
        .regex(/^\+[1-9][0-9 ]{7,18}$/, "Format international attendu, ex. +225 07 07 07 07 07"),
    ])
    .optional(),
  contactAddress: z.string().trim().max(200).optional(),
  /** Ask each customer for a review after a delivered order / a completed booking. */
  reviewRequestsEnabled: z.boolean().optional(),
  /** Omit to show every section `enabledModules` allows; pass an explicit array to restrict. */
  storefrontSections: z.array(z.enum(STOREFRONT_SECTIONS)).optional(),
  /** Omit to use the vertical's default template — see EntitlementsService.assertStorefrontThemeAllowed. */
  storefrontTemplate: z.enum(STOREFRONT_TEMPLATE_KEYS).optional(),
  storefrontPalette: z.enum(STOREFRONT_PALETTE_KEYS).optional(),
  storefrontFontPairing: z.enum(STOREFRONT_FONT_PAIRING_KEYS).optional(),
  /** Flat shipping rate applied to every storefront order at checkout. */
  shippingFlatRate: z.number().nonnegative().optional(),
  /** Whole-array replace. Must stay non-empty once set: a shop offering no way to receive an
   *  order cannot take one. */
  fulfillmentModes: z.array(z.enum(FULFILLMENT_MODES)).min(1).optional(),
  deliveryZones: z.array(deliveryZoneSchema).max(30).optional(),
  pickupInstructions: z.string().max(500).optional(),
  /** Up to a week. */
  orderLeadTimeMinutes: z.number().int().min(0).max(10080).optional(),
  checkInTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm").optional(),
  checkOutTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:mm").optional(),
  /** Omit to accept cash only (today's universal default). Must stay non-empty — a storefront
   *  offering no payment method at all isn't a valid checkout configuration. */
  acceptedPaymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1).optional(),
  /** Sent with the save that turns online payment on: the terms version the user accepted. */
  acceptOnlinePaymentTerms: z.string().max(20).optional(),
  enabledModules: z.array(z.enum(KORVA_MODULES)).optional(),
  /** Whole-array replace: the trade tools brought back into the menu (Settings › Autres outils). */
  extraTools: z.array(z.enum(TRADE_TOOLS)).max(TRADE_TOOLS.length).optional(),
  /** Long-form "about us" text for the public storefront — Pro plan and above. */
  aboutText: z.string().max(4000).optional(),
  /** Google typically truncates a title around 60 chars and a description around 155-160 —
   *  these caps are generous headroom above that, not a hard SEO best-practice enforcement. */
  seoTitle: z.string().max(70).optional(),
  seoDescription: z.string().max(200).optional(),
  /** Phase E3 v1 custom domain — a bare hostname, no "https://" scheme and no path (the owner
   *  points it at the storefront via a CNAME record, entered here exactly as they'd type it
   *  into their DNS provider). Uniqueness enforced by OrganizationsService.update, not this
   *  schema alone. */
  customDomain: z
    .string()
    .max(253)
    .regex(
      /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i,
      'Must be a bare domain name, e.g. www.masociete.com (no https:// or path)',
    )
    .transform((value) => value.toLowerCase())
    .optional(),
  testimonials: z.array(testimonialSchema).max(20).optional(),
  teamMembers: z.array(teamMemberSchema).max(30).optional(),
  galleryImages: z.array(galleryImageSchema).max(40).optional(),
  faqItems: z.array(faqItemSchema).max(30).optional(),
});
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export const enabledModulesSchema = z.array(z.enum(KORVA_MODULES));

export const addMemberSchema = z.object({
  email: z.string().email(),
  roleId: z.string().min(1),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const updateMemberRoleSchema = z.object({
  roleId: z.string().min(1),
});
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export const updateMemberRateSchema = z.object({
  defaultHourlyRate: z.number().positive(),
});
export type UpdateMemberRateInput = z.infer<typeof updateMemberRateSchema>;

export const updateMemberCommissionRateSchema = z.object({
  commissionRateBasisPoints: z.number().int().min(0).max(10000),
});
export type UpdateMemberCommissionRateInput = z.infer<
  typeof updateMemberCommissionRateSchema
>;

export const commissionReportQuerySchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
});
export type CommissionReportQuery = z.infer<typeof commissionReportQuerySchema>;

/**
 * `password`/`firstName`/`lastName` are only required when the invited email has no existing
 * KORVA account yet — InvitationsService.accept enforces that conditionally, since a static
 * schema can't know in advance which branch applies (see PASSWORD_REQUIRED there).
 */
export const acceptInvitationSchema = z.object({
  password: z.string().min(8).max(72).optional(),
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
});
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
