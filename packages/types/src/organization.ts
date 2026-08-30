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

export interface OrganizationSettings {
  onboardingCompleted: boolean;
  [key: string]: unknown;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  legalName?: string;
  type: string;
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
  settings: OrganizationSettings;
  enabledModules: KorvaModule[];
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
