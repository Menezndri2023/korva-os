import type { DeliveryZone, FulfillmentMode } from "./commerce.ts";
import type { BusinessModel } from "./business-models.ts";
import type {
  StorefrontFontPairingKey,
  StorefrontPaletteKey,
  StorefrontTemplateKey,
} from "./storefront-themes.ts";

/** Not a closed enum on purpose — organizations must not be limited to a fixed set of business types. */
export const SUGGESTED_ORGANIZATION_TYPES = [
  "service",
  "commerce",
  "ecommerce",
  "booking",
  "professional",
  "other",
] as const;

export const KORVA_MODULES = [
  "crm",
  "catalog",
  "booking",
  "commerce",
  "finance",
  "workflow",
  "communication",
  "analytics",
  "ai",
  "website",
  "marketing",
] as const;

export type KorvaModule = (typeof KORVA_MODULES)[number];

/**
 * The two storefront areas an org owner can independently show/hide on their public page,
 * regardless of `enabledModules` — e.g. booking stays enabled for internal/staff use but is
 * hidden from the public page. A section only ever renders when BOTH its module is enabled AND
 * (if `storefrontSections` is set) it's included here — see PublicService#getOrganization's
 * `visibleSections` computation, which is what apps/storefront actually reads.
 */
export const STOREFRONT_SECTIONS = ["catalog", "booking"] as const;
export type StorefrontSection = (typeof STOREFRONT_SECTIONS)[number];

/**
 * Which checkout payment method(s) a storefront offers — independent of `enabledModules`. Every
 * organization defaults to `["cash"]` (see the schema default) since that's the only method that
 * has ever existed: order creation itself never collects payment, so "cash" really means "any
 * arrangement made outside KORVA" (cash on delivery/pickup, bank transfer, an invoice sent
 * later), not literally banknotes. "online" is only ever offered to the customer if it's both
 * listed here AND a real PSP actually resolves for the organization's market (see
 * PublicService — an org can't advertise online payment it has no way to actually collect).
 */
export const PAYMENT_METHODS = ["cash", "online"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface OrganizationSettings {
  onboardingCompleted: boolean;
  [key: string]: unknown;
}

/**
 * Storefront "content" sections — testimonials/team/gallery/about — gated behind the Pro plan
 * (see EntitlementsService.assertContentSectionsAllowed) and rendered by every storefront
 * template (apps/storefront/src/templates/sections/). These are free-form content an org owner
 * fills in themselves, distinct from the structural template/palette/font choice.
 */
export interface Testimonial {
  id: string;
  authorName: string;
  role?: string;
  quote: string;
  /** 1-5, optional — a testimonial doesn't have to carry a star rating. */
  rating?: number;
}

export interface TeamMember {
  id: string;
  name: string;
  role: string;
  photo?: string;
  bio?: string;
}

export interface GalleryImage {
  id: string;
  url: string;
  caption?: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  legalName?: string;
  type: string;
  /** Type of activity — see business-models.ts. Absent for an organization created before it
   *  existed whose trade could not be recognised; every reader then keeps the older behaviour. */
  businessModel?: BusinessModel;
  country: string;
  currency: string;
  timezone: string;
  language: string;
  logo?: string;
  brandColor?: string;
  tagline?: string;
  heroImage?: string;
  /** Undefined means "show every section `enabledModules` allows" — see STOREFRONT_SECTIONS doc. */
  storefrontSections?: StorefrontSection[];
  /**
   * Explicit storefront visual template choice — see storefront-themes.ts. Undefined means "use
   * the vertical's default template" (VerticalTemplate.defaultStorefrontTemplate), or "essentiel"
   * if the org's `type` doesn't match a known vertical. Enforced against the org's plan by
   * EntitlementsService.assertStorefrontThemeAllowed.
   */
  storefrontTemplate?: StorefrontTemplateKey;
  /** Undefined means "deterministically derived from the organization id" — see PublicService. */
  storefrontPalette?: StorefrontPaletteKey;
  storefrontFontPairing?: StorefrontFontPairingKey;
  /** Flat shipping rate applied to every storefront order at checkout — undefined charges none. */
  shippingFlatRate?: number;
  /** How storefront orders can be received. Undefined keeps the older behaviour (the flat rate
   *  above on every order); once set, delivery fees apply to delivery only. */
  fulfillmentModes?: FulfillmentMode[];
  /** Delivery areas. When present, a delivery order must name one and pays its fee instead of
   *  shippingFlatRate. */
  deliveryZones?: DeliveryZone[];
  /** Shown to a customer who chooses pickup (address, opening hours, where to ask). */
  pickupInstructions?: string;
  /** Minimum time between ordering and a requested pickup/delivery time. */
  orderLeadTimeMinutes?: number;
  /** Lodging: when a stay starts on its arrival date and ends on its departure date, in the
   *  organization's timezone ("HH:mm"). DEFAULT_CHECK_IN_TIME / DEFAULT_CHECK_OUT_TIME apply
   *  when unset. */
  checkInTime?: string;
  checkOutTime?: string;
  /** Never empty in practice — the schema defaults new organizations to `["cash"]`. See
   *  PAYMENT_METHODS' own doc comment. */
  acceptedPaymentMethods?: PaymentMethod[];
  /** Long-form "about us" text for the public storefront — Pro plan and above, see
   *  EntitlementsService.assertContentSectionsAllowed. Distinct from the short `tagline`. */
  aboutText?: string;
  /** Org-configurable SEO title/description override for the public storefront page — every
   *  plan tier, unlike the content sections above. Undefined falls back to an auto-derived
   *  title/description. */
  seoTitle?: string;
  seoDescription?: string;
  /** v1 custom domain — a bare hostname (no scheme/path), e.g. "www.masociete.com". Undefined
   *  means the org is only reachable at the shared `{STOREFRONT_URL}/{slug}` URL. */
  customDomain?: string;
  testimonials?: Testimonial[];
  teamMembers?: TeamMember[];
  galleryImages?: GalleryImage[];
  faqItems?: FaqItem[];
  settings: OrganizationSettings;
  enabledModules: KorvaModule[];
  /** AI autonomy level 4 — tool names allowed to run without the usual pending-confirmation
   *  step. See Organization schema's own doc comment (apps/api) for the full design. */
  aiAutoApprovedTools?: string[];
  createdAt: string;
  updatedAt: string;
}

export const MEMBERSHIP_STATUSES = ["invited", "active", "suspended"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export interface Membership {
  id: string;
  userId: string;
  organizationId: string;
  roleId: string;
  status: MembershipStatus;
  /** Fallback used by TimeEntriesService.create when neither the caller nor the billed
   *  contact provides an hourlyRate — this staff member's own default billing rate.
   *  Denominated in the organization's currency. */
  defaultHourlyRate?: number;
  /** Share of this staff member's billed-and-paid work paid out to them as commission, in
   *  basis points (0-10000, i.e. 500 = 5%). Absent means no commission arrangement. */
  commissionRateBasisPoints?: number;
}

export const INVITATION_STATUSES = ["pending", "accepted"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  roleId: string;
  invitedByUserId: string;
  status: InvitationStatus;
  expiresAt: string;
  acceptedAt?: string | null;
  createdAt: string;
}
