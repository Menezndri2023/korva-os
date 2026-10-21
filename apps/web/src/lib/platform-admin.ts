import { useQuery } from "@tanstack/react-query";
import { CURRENCY_FORMAT, type BillingCurrency, type BusinessModel } from "@korva/types";
import { apiClient } from "./api-client";
import { useAuthStore } from "./auth-store";

/**
 * Whether the signed-in user belongs to KORVA's own administration. Asked once per session
 * (GET /platform/me answers 403 for everyone else) — the API decides, this only shows or hides
 * the way in.
 */
export function usePlatformAdmin() {
  const bootstrapped = useAuthStore((state) => state.bootstrapped);
  const accessToken = useAuthStore((state) => state.accessToken);
  return useQuery({
    queryKey: ["platform", "me"],
    queryFn: () => apiClient.get<{ email: string }>("/platform/me", { withOrganization: false }),
    enabled: bootstrapped && Boolean(accessToken),
    retry: false,
    staleTime: Infinity,
  });
}

export function formatMoney(amount: number, currency: string): string {
  const format = CURRENCY_FORMAT[currency as BillingCurrency];
  return format ? format.display(amount) : `${amount.toLocaleString("fr-FR")} ${currency}`;
}

export function formatDay(value: string | null | undefined): string {
  return value
    ? new Date(value).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
    : "—";
}

export type Channel = "orders" | "bookings" | "quotes" | "leads";

/** What "activity" counts for each trade, in words. */
export const CHANNEL_LABELS: Record<Channel, { one: string; many: string }> = {
  orders: { one: "commande", many: "commandes" },
  bookings: { one: "réservation", many: "réservations" },
  quotes: { one: "devis", many: "devis" },
  leads: { one: "prospect", many: "prospects" },
};

export function channelCount(count: number, channel: Channel | null): string {
  if (!channel) return `${count} activité${count > 1 ? "s" : ""}`;
  const label = CHANNEL_LABELS[channel];
  return `${count} ${count > 1 ? label.many : label.one}`;
}

export interface PlatformOverview {
  byBusinessModel: {
    businessModel: BusinessModel | "none";
    organizations: number;
    sitesOnline: number;
    activity30d: number;
    channel: Channel | null;
  }[];
  organizations: number;
  newLast7Days: number;
  newLast30Days: number;
  sitesOnline: number;
  offersOnline: number;
  ordersLast30Days: number;
  bookingsLast30Days: number;
  trialsRunning: number;
  pastDue: number;
  organizationsByPlan: Record<string, number>;
  monthlyRevenueByCurrency: Record<string, number>;
}

export interface PlatformSubscriptionRow {
  organizationId: string;
  organizationName: string;
  slug: string;
  planKey: string;
  planName: string;
  priceAmount: number;
  priceCurrency: string;
  status: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trialPlanKey: string | null;
  trialEndsAt: string | null;
}

export interface PlatformOrganization {
  id: string;
  name: string;
  slug: string;
  type?: string;
  businessModel?: BusinessModel;
  country?: string;
  currency: string;
  createdAt: string;
  logo?: string;
  whatsappNumber?: string;
  contactPhone?: string;
  enabledModules: string[];
  activationNudgeSentAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
  counts: {
    offersOnline: number;
    offersTotal: number;
    orders: number;
    bookings: number;
    quotes: number;
    leads: number;
    contacts: number;
    invoices: number;
  };
  members: { email: string; name: string | null; status: string }[];
  subscription: {
    planKey: string | null;
    planName: string | null;
    priceAmount: number;
    priceCurrency: string | null;
    status: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    trialPlanKey: string | null;
    trialEndsAt: string | null;
  } | null;
  invoices: {
    id: string;
    number: string;
    amount: number;
    currency: string;
    status: string;
    periodStart: string;
    periodEnd: string;
    dueAt: string;
    paidAt: string | null;
  }[];
  recentActivity: { action: string; entity: string; createdAt: string; metadata?: Record<string, unknown> }[];
}

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: "Actif",
  past_due: "Impayé",
  canceled: "Résilié",
};

/**
 * Where to send a user who belongs to no organization yet: KORVA's administrators to /admin
 * (they have no business of their own to set up), everyone else to onboarding. A 403 — the
 * usual answer — simply means "not an administrator".
 */
export async function homeWithoutOrganization(): Promise<"/admin" | "/onboarding"> {
  try {
    await apiClient.get("/platform/me", { withOrganization: false });
    return "/admin";
  } catch {
    return "/onboarding";
  }
}

export type BusinessIssue = "site_vide" | "sans_logo" | "sans_whatsapp" | "inactif";

export interface PlatformBusinessRow {
  id: string;
  name: string;
  slug: string;
  businessModel?: BusinessModel;
  createdAt: string;
  ownerEmail: string | null;
  activeOffers: number;
  hasLogo: boolean;
  hasWhatsapp: boolean;
  websiteEnabled: boolean;
  lastActivityAt: string | null;
  nudgedAt: string | null;
  suspendedAt: string | null;
  issues: BusinessIssue[];
  planKey: string | null;
  activity30d: number;
  channel: Channel | null;
}

export interface PlatformUserRow {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
  emailVerified: boolean;
  twoFactor: boolean;
  disabledAt: string | null;
  lastActivityAt: string | null;
  organizations: { id: string; name: string; status: string }[];
}

export interface PlatformPlanRow {
  key: string;
  name: string;
  priceAmount: number;
  priceCurrency: string;
  modules: string[];
  limits: Record<string, number>;
  subscribers: number;
}

export interface PlatformAuditRow {
  id: string;
  organizationId: string;
  organizationName: string;
  userEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PlatformSystem {
  api: { uptimeSeconds: number; nodeVersion: string; environment: string };
  database: { dataBytes: number; storageBytes: number; indexBytes: number; collections: number; freeTierCapBytes: number };
  email: { configured: boolean; provider: string; from: string | null };
  payments: { platformAccounts: number };
  administrators: number;
  queues: { name: string; label: string; waiting: number; active: number; delayed: number; failed: number }[] | null;
}
