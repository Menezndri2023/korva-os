import { z } from "zod";
import {
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
  country: z.string().length(2),
  currency: z.string().length(3),
  timezone: z.string().min(1),
  language: z.string().min(2).max(10).default("fr"),
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

export const updateOrganizationSchema = createOrganizationSchema.partial().extend({
  legalName: z.string().max(200).optional(),
  logo: z.string().url().optional(),
  brandColor: hexColorSchema.optional(),
  /** Short pitch shown under the org name in the public storefront hero. */
  tagline: z.string().max(200).optional(),
  /** Wide banner image for the storefront hero, distinct from `logo`. */
  heroImage: z.string().url().optional(),
  /** Omit to show every section `enabledModules` allows; pass an explicit array to restrict. */
  storefrontSections: z.array(z.enum(STOREFRONT_SECTIONS)).optional(),
  /** Omit to use the vertical's default template — see EntitlementsService.assertStorefrontThemeAllowed. */
  storefrontTemplate: z.enum(STOREFRONT_TEMPLATE_KEYS).optional(),
  storefrontPalette: z.enum(STOREFRONT_PALETTE_KEYS).optional(),
  storefrontFontPairing: z.enum(STOREFRONT_FONT_PAIRING_KEYS).optional(),
  /** Flat shipping rate applied to every storefront order at checkout. */
  shippingFlatRate: z.number().nonnegative().optional(),
  /** Omit to accept cash only (today's universal default). Must stay non-empty — a storefront
   *  offering no payment method at all isn't a valid checkout configuration. */
  acceptedPaymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1).optional(),
  enabledModules: z.array(z.enum(KORVA_MODULES)).optional(),
  /** Long-form "about us" text for the public storefront — Pro plan and above. */
  aboutText: z.string().max(4000).optional(),
  testimonials: z.array(testimonialSchema).max(20).optional(),
  teamMembers: z.array(teamMemberSchema).max(30).optional(),
  galleryImages: z.array(galleryImageSchema).max(40).optional(),
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
