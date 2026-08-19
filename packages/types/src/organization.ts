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
}
