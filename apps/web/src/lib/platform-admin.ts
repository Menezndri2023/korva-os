import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import {
  CURRENCY_FORMAT,
  type BillingCurrency,
  type BusinessModel,
  type KorvaAiSystemStatus,
  type Pagination,
} from "@korva/types";
import { ApiError } from "./api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

/*
 * KORVA's administration has its OWN session, kept apart from the businesses' one (auth-store):
 * its own accounts, its own sign-in (/admin/connexion), its own token. The token lives in
 * sessionStorage — this tab only, gone when it closes — and never in the businesses' store, so
 * an administrator's session can never be used against a business, nor the reverse.
 */
const TOKEN_KEY = "korva-admin-token";
const listeners = new Set<() => void>();
let memoryToken: string | null = null;

function readToken(): string | null {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setAdminToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage blocked (private mode): the in-memory copy still works for this page.
  }
  listeners.forEach((listener) => listener());
}

/** The administrator token, or null — "" during the server render, before the browser is read. */
export function useAdminToken(): string | null | "" {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readToken,
    () => "",
  );
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  pagination?: Pagination;
  error?: { code: string; message: string; details?: unknown };
}

async function adminRequest<T>(method: string, path: string, body?: unknown): Promise<Envelope<T>> {
  const token = readToken();
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json()) as Envelope<T>;
  if (!payload.success) {
    const error = payload.error ?? { code: "UNKNOWN", message: "Request failed" };
    // An expired or revoked administrator session: forget it, the layout sends to sign-in.
    if (error.code === "PLATFORM_ADMIN_ONLY") setAdminToken(null);
    throw new ApiError(error.code, error.message, error.details);
  }
  return payload;
}

/** The administration's API client: the administrator token, never a business's session. */
export const adminApi = {
  get: <T>(path: string) => adminRequest<T>("GET", path).then((payload) => payload.data as T),
  getList: <T>(path: string) =>
    adminRequest<T[]>("GET", path).then((payload) => ({
      data: payload.data as T[],
      pagination: payload.pagination as Pagination,
    })),
  post: <T>(path: string, body?: unknown) =>
    adminRequest<T>("POST", path, body).then((payload) => payload.data as T),
};

/** The signed-in administrator, checked against the API once per session. */
export function usePlatformAdmin() {
  const token = useAdminToken();
  return useQuery({
    queryKey: ["platform", "me", token],
    queryFn: () => adminApi.get<{ email: string }>("/platform/me"),
    enabled: Boolean(token),
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
  ai: KorvaAiSystemStatus;
  administrators: number;
  queues: { name: string; label: string; waiting: number; active: number; delayed: number; failed: number }[] | null;
}

/** GET /platform/todo — the counters behind "À traiter aujourd'hui" and the menu badges. */
export interface PlatformTodo {
  payoutsToApprove: number;
  overdueInvoices: number;
  reviewsToModerate: number;
  pastDueSubscriptions: number;
}

export interface PlatformFinance {
  periodDays: number;
  plansPaid: { currency: string; total: number; count: number }[];
  onlineSales: { currency: string; total: number; count: number; commissions: number; providerFees: number };
  payoutsPaid: { total: number; fees: number; count: number };
  held: { currency: string; available: number; pending: number };
  openInvoices: {
    id: string;
    organizationId: string;
    organizationName: string;
    number: string;
    amount: number;
    currency: string;
    dueAt: string;
    overdue: boolean;
  }[];
}

export interface PlatformSearchResults {
  organizations: { id: string; name: string; slug: string }[];
  users: { id: string; email: string; name: string | null }[];
  invoices: { id: string; number: string; status: string; organizationId: string; organizationName: string }[];
}

export interface PlatformNote {
  id: string;
  text: string;
  authorEmail: string;
  createdAt: string;
}

export interface PlatformPaymentAccounts {
  payoutApproval: "manual" | "auto";
  accounts: {
    id: string;
    provider: string;
    role: string;
    market: string | null;
    status: string;
    lastVerifiedAt: string | null;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
    lastWebhookAt: string | null;
    webhooksLast24h: number;
  }[];
}

/** Shared by the layout badges and the overview — one request, cached under one key. */
export function usePlatformTodo() {
  return useQuery({
    queryKey: ["platform", "todo"],
    queryFn: () => adminApi.get<PlatformTodo>("/platform/todo"),
    refetchInterval: 60_000,
  });
}
