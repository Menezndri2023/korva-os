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

export interface PlatformOverview {
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
  counts: { offersOnline: number; offersTotal: number; orders: number; bookings: number };
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
