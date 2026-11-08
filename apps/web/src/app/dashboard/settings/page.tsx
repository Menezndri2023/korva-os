"use client";

import { OnlinePaymentFees } from "@/components/online-payment-fees";
import { LoyaltySettings } from "@/components/loyalty";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { KorvaPlanInvoices } from "@/components/korva-plan-invoices";
import { OtherToolsSettings } from "@/components/other-tools-settings";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BUSINESS_MODELS,
  BUSINESS_MODEL_DEFINITIONS,
  businessModelText,
  CORE_PERMISSIONS,
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  KORVA_MODULES,
  KORVA_PRODUCTS,
  PRODUCT_MODULES,
  resolveEffectiveModules,
  STOREFRONT_SECTIONS,
  STOREFRONT_TEMPLATES,
  STOREFRONT_PALETTES,
  STOREFRONT_FONT_PAIRINGS,
  SUPPORTED_BILLING_CURRENCIES,
  SYSTEM_EVENTS,
  organizationHasFeature,
  ONLINE_PAYMENT_TERMS_VERSION,
  onlinePaymentTermsAccepted,
  planMeetsMinimum,
  planHasFeature,
  PREMIUM_FONT_PAIRING_KEYS,
  PREMIUM_PALETTE_KEYS,
  PREMIUM_THEME_MIN_PLAN,
  type StorefrontFontPairingKey,
  type StorefrontPaletteKey,
  type StorefrontTemplateKey,
} from "@korva/types";
import type {
  Locale,
  AiUsageSummary,
  AuditLogEntry,
  ConnectMessagingAccountInput,
  ConnectPaymentPayoutInput,
  CustomField,
  CustomFieldEntity,
  FaqItem,
  GalleryImage,
  IntegrationAccountStatus,
  IntegrationDomain,
  IntegrationSummary,
  KorvaModule,
  KorvaProduct,
  Organization,
  Plan,
  PlanKey,
  SubscriptionSummary,
  TeamMember,
  Testimonial,
  TestConnectionResult,
  WebhookDelivery,
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
} from "@korva/types";
import {
  addMemberSchema,
  HERO_SLIDES_MAX,
  createCustomFieldSchema,
  createRoleSchema,
  createWebhookSubscriptionSchema,
  updateOrganizationSchema,
  type AddMemberInput,
  type CreateCustomFieldInput,
  type CreateRoleInput,
  type CreateWebhookSubscriptionInput,
  type UpdateOrganizationInput,
} from "@korva/validation";
import { Badge, Button, Dialog, Input, Notice, Select } from "@korva/ui";
import type { BadgeVariant } from "@korva/ui";
import { apiClient, ApiError, uploadFile } from "@/lib/api-client";
import { OrderReceptionSettings } from "@/components/order-reception-settings";
import { StaySettings } from "@/components/stay-settings";
import { PlanLock } from "@/components/plan-lock";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { formatCurrency } from "@/lib/analytics-format";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useAuthStore } from "@/lib/auth-store";
import { useAuthReady } from "@/lib/use-auth-ready";
import { SettingsTabPanel, SettingsTabs, useSettingsTab } from "./settings-tabs";
import { STOREFRONT_URL } from "@/lib/storefront-url";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

interface MemberRow {
  id: string;
  status: string;
  userId: { id: string; email: string; firstName?: string; lastName?: string };
  roleId: { id: string; name: string; systemKey?: string };
  defaultHourlyRate?: number;
  commissionRateBasisPoints?: number;
}

interface RoleOption {
  id: string;
  name: string;
  systemKey?: string;
}

interface PendingInvitation {
  id: string;
  email: string;
  roleId: string;
  status: string;
  expiresAt: string;
}

const METRIC_LABELS: Record<string, [string, string]> = {
  // Seats are dashboard logins. Bookable team members (Réservations › Équipe et ressources) need
  // no account and use none — the label must not suggest otherwise.
  seats: ["Utilisateurs du tableau de bord", "Dashboard users"],
  offers: ["Offres au catalogue", "Catalogue offers"],
  bookable_staff: ["Membres d'équipe réservables", "Bookable team members"],
  workflows: ["Automatisations", "Automations"],
  ai_messages_per_month: ["Messages IA / mois", "AI messages / month"],
};

const MODULE_LABELS: Record<KorvaModule, [string, string]> = {
  crm: ["Clients & Prospects (CRM)", "Customers & leads (CRM)"],
  catalog: ["Produits & Services", "Products & services"],
  booking: ["Réservations", "Bookings"],
  commerce: ["Commandes & E-commerce", "Orders & e-commerce"],
  finance: ["Devis & Factures", "Quotes & invoices"],
  workflow: ["Automatisations", "Automations"],
  communication: ["Communication", "Messages"],
  analytics: ["Statistiques", "Statistics"],
  ai: ["Assistant IA", "AI assistant"],
  website: ["Site web", "Website"],
  marketing: ["Marketing", "Marketing"],
};

const PRODUCT_LABELS: Record<KorvaProduct, [string, string]> = {
  crm: ["CRM", "CRM"],
  inventory: ["Inventaire", "Inventory"],
  website: ["Site web", "Website"],
  ai: ["Assistant IA", "AI assistant"],
};

// Deliberately worded to never contain a MODULE_LABELS value as a substring (e.g. "Assistant
// IA", "Site web") — role+name queries (tests, screen readers) match by substring, so two
// same-page checkboxes sharing that substring would be indistinguishable even though they
// control different things (a product toggle here vs. a module toggle in the section below).
const PRODUCT_ARIA_LABELS: Record<KorvaProduct, [string, string]> = {
  crm: ["Produit CRM", "CRM product"],
  inventory: ["Produit Inventaire", "Inventory product"],
  website: ["Produit web (vitrine)", "Web product (showcase)"],
  ai: ["Produit IA", "AI product"],
};

// Same list as apps/web/src/app/onboarding/page.tsx — kept local rather than shared, matching
// that page's own precedent, since neither list is large enough yet to be worth extracting.
const COUNTRIES = ["FR", "CI", "SN", "MA", "BE", "CA"] as const;

/** A country's name in the dashboard language, from the browser's own list. */
function countryName(code: string, locale: Locale): string {
  return new Intl.DisplayNames([intlLocale(locale)], { type: "region" }).of(code) ?? code;
}
// Imported, no longer re-declared here and in onboarding: the list now also decides which
// Plan documents exist (see PlansService.list), so a local copy could drift from what is
// actually billable.
const CURRENCIES = [...SUPPORTED_BILLING_CURRENCIES];
const TIMEZONES = Intl.supportedValuesOf("timeZone");

// Wave 4 Stage 2 — one card per known integration TYPE, not per row returned by the API: the
// backend controller (built in a separate isolated worktree against the same
// packages/types/src/integrations.ts contract) always returns at most one IntegrationSummary
// per domain per tenant today, so a fixed slot per domain is what lets "not yet connected"
// render as a real card (with its own Connecter action) instead of disappearing entirely.
const INTEGRATION_SLOTS: Array<{
  domain: IntegrationDomain;
  title: [string, string];
  description: [string, string];
  // Both domains reuse IntegrationSummary.market as the one connected-state descriptor the
  // contract exposes — it has no separate WABA-display-name field (deliberately secret-free,
  // see integrations.ts's doc comment) — so this only changes the *label* shown above it, not
  // which field is read.
  connectedLabel: [string, string];
}> = [
  {
    // Not yet connected: no provider name here — which PSP ends up handling this organization's
    // payments is resolved server-side by market (see PaymentProviderResolverService), never
    // chosen by the tenant, so naming one specific provider before a real connection exists would
    // just be a guess. Once connected, the card below names the ACTUAL resolved provider via
    // PAYMENT_PROVIDER_DISPLAY_NAMES — this static copy is only ever shown pre-connection.
    domain: "payment",
    title: ["Paiements", "Payments"],
    description: ["Recevez vos règlements en ligne.", "Get paid online."],
    connectedLabel: ["Marché", "Market"],
  },
  {
    domain: "messaging",
    title: ["WhatsApp Business — 360dialog", "WhatsApp Business — 360dialog"],
    description: ["Envoyez et recevez des messages WhatsApp avec vos clients.", "Send and receive WhatsApp messages with your customers."],
    connectedLabel: ["Compte connecté", "Connected account"],
  },
];

/** Only `flutterwave`/`paystack` have real adapters (docs/BUSINESS_OS_AUDIT.md §6) — an unknown
 *  future provider key just falls back to itself, capitalized, rather than a hardcoded name. */
const PAYMENT_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  flutterwave: "Flutterwave",
  paystack: "Paystack",
  manual: "Manuel",
};

function paymentProviderDisplayName(provider: string, locale: Locale): string {
  if (provider === "manual" && locale === "en") return "Manual";
  return (
    PAYMENT_PROVIDER_DISPLAY_NAMES[provider] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

const INTEGRATION_STATUS_BADGE: Record<
  IntegrationAccountStatus,
  { variant: BadgeVariant; label: [string, string] }
> = {
  pending: { variant: "warning", label: ["En attente", "Pending"] },
  active: { variant: "success", label: ["Actif", "Active"] },
  disabled: { variant: "default", label: ["Désactivé", "Off"] },
  revoked: { variant: "destructive", label: ["Révoqué", "Revoked"] },
  error: { variant: "destructive", label: ["Erreur", "Error"] },
};

// Reconciled at Wave 4 Stage 2 convergence against the real FlutterwaveProvider adapter's
// REQUIRED_PAYOUT_DESTINATION_FIELDS (apps/api/src/finance/payments/providers/
// flutterwave-payment.provider.ts) — these are Flutterwave's own Create Subaccount field names
// verbatim (developer.flutterwave.com/v3.0.0/reference/create-a-sub-account.md), not a
// provider-agnostic guess. `account_bank` is Flutterwave's numeric bank code, not a free-text
// bank name — a real implementation would source it from Flutterwave's "Get all banks by
// country" endpoint as a dropdown; a labeled text input is this reconciliation's honest,
// bounded fix, not a finished UX.
interface PaymentPayoutFormValues {
  account_bank: string;
  account_number: string;
  business_name: string;
  country: string;
  split_type: "percentage" | "flat";
  split_value: string;
}

export default function SettingsPage() {
  const locale = useDashboardLocale();
  const t = useT();
  const activeTab = useSettingsTab();
  const queryClient = useQueryClient();
  const { data: organization } = useActiveOrganization();
  const planFeatures = usePlanFeatures();
  // Phase E3 — the bare host a custom domain's CNAME record must target, derived from the same
  // The same base URL every other storefront link on this page uses (storefrontPageUrl etc).
  const storefrontDomainCnameTarget = new URL(STOREFRONT_URL).host;
  const authReady = useAuthReady();
  const currentUserId = useAuthStore((state) => state.user?.id);
  const { data: members, isLoading } = useQuery({
    queryKey: ["organizations", "me", "members"],
    queryFn: () => apiClient.get<MemberRow[]>("/organizations/me/members"),
    enabled: authReady,
  });
  const { data: pendingInvitations } = useQuery({
    queryKey: ["organizations", "me", "invitations"],
    queryFn: () =>
      apiClient.get<PendingInvitation[]>("/organizations/me/invitations"),
    enabled: authReady,
  });
  const { data: subscription } = useQuery({
    queryKey: ["subscriptions", "me"],
    queryFn: () => apiClient.get<SubscriptionSummary>("/subscriptions/me"),
    enabled: authReady,
  });
  // Scoped to the organization's own currency: plans are one document per (tier, currency), and
  // showing a price the tenant cannot be charged in would be worse than showing none. Keyed on
  // the currency too, so switching organizations refetches instead of serving a cached list in
  // the wrong currency.
  const organizationCurrency = organization?.currency;
  const { data: plans } = useQuery({
    queryKey: ["plans", organizationCurrency],
    queryFn: () =>
      apiClient.get<Plan[]>(
        organizationCurrency
          ? `/plans?currency=${encodeURIComponent(organizationCurrency)}`
          : "/plans",
      ),
    enabled: authReady,
  });
  // settings.manage-gated (see ai.controller.ts) — non-admin members get PERMISSION_DENIED,
  // handled below the same way the Intégrations section handles it.
  const {
    data: aiUsage,
    error: aiUsageError,
  } = useQuery({
    queryKey: ["ai", "usage-summary"],
    queryFn: () => apiClient.get<AiUsageSummary>("/ai/usage-summary"),
    // The AI routes answer MODULE_NOT_ENABLED while KORVA IA is off: nothing to ask then.
    enabled: authReady && Boolean(organization?.enabledModules.includes("ai")),
  });
  const aiUsagePermissionDenied =
    aiUsageError instanceof ApiError && aiUsageError.code === "PERMISSION_DENIED";

  // Autonomy level 4 (docs/KORVA_OS_V2_AUDIT.md §2.3) — gated by ai.execute_sensitive_actions,
  // not settings.manage, since granting auto-approval requires the same authority as manually
  // confirming a sensitive action, not general admin access.
  const {
    data: sensitiveTools,
    error: sensitiveToolsError,
  } = useQuery({
    queryKey: ["ai", "sensitive-tools"],
    queryFn: () =>
      apiClient.get<{ name: string; description: string }[]>("/ai/sensitive-tools"),
    enabled: authReady && Boolean(organization?.enabledModules.includes("ai")),
  });
  const sensitiveToolsPermissionDenied =
    sensitiveToolsError instanceof ApiError &&
    sensitiveToolsError.code === "PERMISSION_DENIED";

  const autoApprovedToolsMutation = useMutation({
    mutationFn: (toolNames: string[]) =>
      apiClient.patch<{ toolNames: string[] }>("/ai/auto-approved-tools", { toolNames }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });

  function toggleAutoApprovedTool(toolName: string, currentlyApproved: boolean) {
    const current = organization?.aiAutoApprovedTools ?? [];
    const next = currentlyApproved
      ? current.filter((name) => name !== toolName)
      : [...current, toolName];
    autoApprovedToolsMutation.mutate(next);
  }

  const [inviteOpen, setInviteOpen] = useState(false);
  const {
    data: roles,
    isLoading: rolesLoading,
    isError: rolesError,
    refetch: refetchRoles,
  } = useQuery({
    queryKey: ["organizations", "me", "roles"],
    queryFn: () => apiClient.get<RoleOption[]>("/organizations/me/roles"),
    enabled: authReady,
  });

  const {
    register: registerInvite,
    handleSubmit: handleInviteSubmit,
    reset: resetInviteForm,
    formState: { errors: inviteErrors },
  } = useForm<AddMemberInput>({ resolver: zodResolver(addMemberSchema) });

  // Sends a real email invitation (POST /organizations/me/invitations) rather than
  // POST /organizations/me/members, which silently 404s (USER_NOT_FOUND) for anyone who doesn't
  // already have a KORVA account — see InvitationsService. Inviting someone doesn't create a
  // membership yet (they still have to accept), so this invalidates the pending-invitations
  // list, not the members list; the member only shows up in the team list once they accept.
  const inviteMemberMutation = useMutation({
    mutationFn: (input: AddMemberInput) =>
      apiClient.post<PendingInvitation>("/organizations/me/invitations", input),
    onSuccess: () => {
      resetInviteForm();
      return queryClient.invalidateQueries({
        queryKey: ["organizations", "me", "invitations"],
      });
    },
  });

  // A paid plan opens once paid: the answer is then the invoice to settle, shown in
  // KorvaPlanInvoices right below the plans.
  const changePlanMutation = useMutation({
    mutationFn: (planKey: string) =>
      apiClient.post<{ paymentRequired?: boolean }>("/subscriptions/change-plan", { planKey }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["subscriptions"] }),
  });

  // Organization profile edit (name/legalName/type/country/currency/timezone/language/logo/
  // brandColor/tagline/heroImage) — PATCH /organizations/me already supported all of these fields (see
  // updateOrganizationSchema); only the Modules section actually called it. Same
  // toggle-open/reset-on-open/non-optimistic pattern as the CRM contact detail page's edit form.
  const [orgEditOpen, setOrgEditOpen] = useState(false);
  const {
    register: registerOrg,
    handleSubmit: handleOrgSubmit,
    reset: resetOrgForm,
    setValue: setOrgValue,
    watch: watchOrg,
    formState: { errors: orgErrors },
  } = useForm<UpdateOrganizationInput>({ resolver: zodResolver(updateOrganizationSchema) });
  const [logoUploading, setLogoUploading] = useState(false);
  const [heroImageUploading, setHeroImageUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const watchedLogo = watchOrg("logo");
  const watchedHeroImage = watchOrg("heroImage");
  const watchedBrandColor = watchOrg("brandColor");
  const watchedStorefrontTemplate = watchOrg("storefrontTemplate");
  const watchedStorefrontPalette = watchOrg("storefrontPalette");
  const watchedStorefrontFontPairing = watchOrg("storefrontFontPairing");
  // Online payment is the business's choice, made with the terms accepted (API: ONLINE_PAYMENT_TERMS_REQUIRED).
  const watchedPaymentMethods = watchOrg("acceptedPaymentMethods");
  const [acceptOnlineTerms, setAcceptOnlineTerms] = useState(false);
  const [termsMissing, setTermsMissing] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const heroImageFileInputRef = useRef<HTMLInputElement>(null);

  async function handleImageUpload(
    field: "logo" | "heroImage",
    file: File | undefined,
    setUploading: (value: boolean) => void,
  ) {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const result = await uploadFile(file);
      setOrgValue(field, result.url, { shouldDirty: true });
    } catch (error) {
      setUploadError(error instanceof ApiError ? error.message : t(
        "Échec de l'envoi du fichier.",
        "The file could not be uploaded.",
      ));
    } finally {
      setUploading(false);
    }
  }

  function startOrgEdit() {
    if (!organization) return;
    setOrgEditOpen(true);
    resetOrgForm({
      name: organization.name,
      legalName: organization.legalName,
      type: organization.type,
      businessModel: organization.businessModel,
      country: organization.country,
      currency: organization.currency,
      timezone: organization.timezone,
      language: organization.language,
      logo: organization.logo,
      brandColor: organization.brandColor,
      tagline: organization.tagline,
      // "" rather than undefined: saving an emptied field must clear it, and undefined would
      // simply leave the old number in place.
      contactPhone: organization.contactPhone ?? "",
      whatsappNumber: organization.whatsappNumber ?? "",
      contactAddress: organization.contactAddress ?? "",
      seoTitle: organization.seoTitle,
      seoDescription: organization.seoDescription,
      customDomain: organization.customDomain,
      heroImage: organization.heroImage,
      shippingFlatRate: organization.shippingFlatRate,
      storefrontTemplate: organization.storefrontTemplate,
      storefrontPalette: organization.storefrontPalette,
      storefrontFontPairing: organization.storefrontFontPairing,
      // Undefined (nothing configured yet) means "show everything modules allow" — pre-check
      // both boxes in that case so the form's visual default matches the real current behavior.
      storefrontSections: organization.storefrontSections ?? [...STOREFRONT_SECTIONS],
      acceptedPaymentMethods: organization.acceptedPaymentMethods ?? ["cash"],
    });
  }
  function cancelOrgEdit() {
    setOrgEditOpen(false);
    resetOrgForm();
  }

  const updateOrgMutation = useMutation({
    mutationFn: (input: UpdateOrganizationInput) =>
      apiClient.patch<Organization>("/organizations/me", input),
    onSuccess: () => {
      setOrgEditOpen(false);
      return queryClient.invalidateQueries({ queryKey: ["organizations", "me"] });
    },
  });

  // Team management was previously add-only — PATCH/DELETE /organizations/me/members/:id now
  // exist (role change, and removal as a status change to 'suspended', never a delete).
  const updateMemberRoleMutation = useMutation({
    mutationFn: ({ id, roleId }: { id: string; roleId: string }) =>
      apiClient.patch<MemberRow>(`/organizations/me/members/${id}`, { roleId }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["organizations", "me", "members"] }),
  });

  // Pre-fills TimeEntry.hourlyRate for this member when a time entry omits one (see
  // time-entries/page.tsx and TimeEntriesService.create's resolution order).
  const updateMemberRateMutation = useMutation({
    mutationFn: ({ id, defaultHourlyRate }: { id: string; defaultHourlyRate: number }) =>
      apiClient.patch<MemberRow>(`/organizations/me/members/${id}/rate`, { defaultHourlyRate }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["organizations", "me", "members"] }),
  });

  // Share of this member's billed-and-paid work paid out to them as commission — see
  // TimeEntriesService.getCommissionReport for how it's applied.
  const updateMemberCommissionRateMutation = useMutation({
    mutationFn: ({
      id,
      commissionRateBasisPoints,
    }: {
      id: string;
      commissionRateBasisPoints: number;
    }) =>
      apiClient.patch<MemberRow>(`/organizations/me/members/${id}/commission-rate`, {
        commissionRateBasisPoints,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["organizations", "me", "members"] }),
  });

  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const removeMemberMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<MemberRow>(`/organizations/me/members/${id}`),
    onSuccess: () => {
      setRemoveConfirmId(null);
      return queryClient.invalidateQueries({ queryKey: ["organizations", "me", "members"] });
    },
    onError: () => setRemoveConfirmId(null),
  });

  // Kept non-optimistic on purpose: checked state always derives straight from
  // organization.enabledModules (server truth), so an error path never leaves a toggle out of
  // sync with reality — there's no local copy to roll back. onSuccess awaits the invalidated
  // refetch (not `void`) so isPending — and therefore the disabled state below — covers the
  // full round trip, not just the PATCH itself; this is what keeps concurrent toggles from
  // racing each other against a stale enabledModules snapshot.
  const modulesMutation = useMutation({
    mutationFn: (enabledModules: KorvaModule[]) =>
      apiClient.patch<Organization>("/organizations/me", { enabledModules }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });

  function toggleModule(module: KorvaModule) {
    if (!organization) return;
    const next = organization.enabledModules.includes(module)
      ? organization.enabledModules.filter((m) => m !== module)
      : [...organization.enabledModules, module];
    modulesMutation.mutate(next);
  }

  // Same non-optimistic idiom as modulesMutation. Invalidates both queries: the override can
  // also prune organization.enabledModules server-side (see SubscriptionsService.
  // updateProductOverrides), so the Modules section's checkboxes must refresh too, not just
  // the Produits section itself.
  const productOverridesMutation = useMutation({
    mutationFn: (productOverrides: Partial<Record<KorvaProduct, boolean>>) =>
      apiClient.patch<SubscriptionSummary["subscription"]>(
        "/subscriptions/product-overrides",
        { productOverrides },
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["subscriptions", "me"] }),
        queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
      ]),
  });

  function toggleProduct(product: KorvaProduct, currentlyActive: boolean) {
    if (!subscription) return;
    const next = {
      ...subscription.subscription.productOverrides,
      [product]: !currentlyActive,
    };
    productOverridesMutation.mutate(next);
  }

  // --- Integrations (Wave 4 Stage 2) ------------------------------------------------------
  const {
    data: integrations,
    isLoading: integrationsLoading,
    isError: integrationsIsError,
    error: integrationsError,
    refetch: refetchIntegrations,
  } = useQuery({
    queryKey: ["organizations", "me", "integrations"],
    queryFn: () => apiClient.get<IntegrationSummary[]>("/organizations/me/integrations"),
    enabled: authReady,
  });

  // Same reasoning as dashboard/page.tsx's hasAnalytics/isPermissionDenied: listing tenant
  // integrations is gated behind settings.manage on the backend (see
  // apps/api/src/integrations/integrations.service.ts's MANAGE_TENANT_INTEGRATIONS_PERMISSION),
  // so a STAFF/SALES member without it gets PERMISSION_DENIED on every load — a permission
  // boundary, not a failure, and must not render as a retry-able error banner.
  const integrationsPermissionDenied =
    integrationsError instanceof ApiError && integrationsError.code === "PERMISSION_DENIED";

  const [paymentFormOpen, setPaymentFormOpen] = useState(false);
  const [messagingFormOpen, setMessagingFormOpen] = useState(false);
  const [disconnectConfirmId, setDisconnectConfirmId] = useState<string | null>(null);

  const {
    register: registerPayment,
    handleSubmit: handlePaymentSubmit,
    reset: resetPaymentForm,
    formState: { errors: paymentErrors },
  } = useForm<PaymentPayoutFormValues>();

  const {
    register: registerMessaging,
    handleSubmit: handleMessagingSubmit,
    reset: resetMessagingForm,
    formState: { errors: messagingErrors },
  } = useForm<ConnectMessagingAccountInput>();

  // Route shape (/organizations/me/integrations/:domain/connect) is this frontend's own
  // reasonable choice, not part of the shared contract — packages/types/src/integrations.ts
  // fixes the request/response DTOs (ConnectPaymentPayoutInput, ConnectMessagingAccountInput,
  // IntegrationSummary) but not the connect endpoint's path, since the backend controller for
  // it is being built by a different Stage 2 lot in an isolated worktree this frontend never
  // sees. Flagged as a second expected reconciliation point at convergence, alongside the
  // payout field names above.
  const connectPaymentMutation = useMutation({
    mutationFn: (input: ConnectPaymentPayoutInput) =>
      apiClient.post<IntegrationSummary>("/organizations/me/integrations/payment/connect", input),
    onSuccess: () => {
      // Never redisplay submitted payout details — clear the form rather than repopulating it
      // from the response (IntegrationSummary carries no such field back anyway).
      resetPaymentForm();
      setPaymentFormOpen(false);
      return queryClient.invalidateQueries({ queryKey: ["organizations", "me", "integrations"] });
    },
  });

  const connectMessagingMutation = useMutation({
    mutationFn: (input: ConnectMessagingAccountInput) =>
      apiClient.post<IntegrationSummary>(
        "/organizations/me/integrations/messaging/connect",
        input,
      ),
    onSuccess: () => {
      resetMessagingForm();
      setMessagingFormOpen(false);
      return queryClient.invalidateQueries({ queryKey: ["organizations", "me", "integrations"] });
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<TestConnectionResult>(
        `/organizations/me/integrations/${id}/test-connection`,
      ),
  });

  // Same click-to-confirm shape as CRM contacts (dashboard/crm/page.tsx) and communication
  // templates: t("Déconnecter", "Disconnect") turns into an inline "Confirmer ?" / "Annuler" pair rather than a
  // native confirm() dialog. Reset on both success and error so a failed disconnect doesn't
  // leave the row stuck on "Confirmer ?".
  const disconnectMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ deleted: true }>(`/organizations/me/integrations/${id}`),
    onSuccess: () => {
      setDisconnectConfirmId(null);
      return queryClient.invalidateQueries({ queryKey: ["organizations", "me", "integrations"] });
    },
    onError: () => setDisconnectConfirmId(null),
  });

  function submitPaymentForm(values: PaymentPayoutFormValues) {
    connectPaymentMutation.mutate({
      payoutDetails: {
        account_bank: values.account_bank,
        account_number: values.account_number,
        business_name: values.business_name,
        country: values.country,
        split_type: values.split_type,
        split_value: values.split_value,
      },
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">{t("Paramètres", "Settings")}</h1>
        <p className="mt-1 text-sm text-text-muted">{t(
          "Votre entreprise, votre site, votre équipe et votre abonnement.",
          "Your business, your website, your team and your subscription.",
        )}</p>
      </div>

      <SettingsTabs active={activeTab} />

      <SettingsTabPanel tab="entreprise" active={activeTab}>
        {/* Not migrated to <Card>: Card always renders a <div>, and these are real document
            <section>s — same exclusion as the raw <form> wrappers elsewhere (dashboard/crm,
            dashboard/bookings). */}
        <section className="rounded-lg border border-border bg-surface p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">{t("Organisation", "Organization")}</h2>
            {organization && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => (orgEditOpen ? cancelOrgEdit() : startOrgEdit())}
              >
                {orgEditOpen ? t("Annuler", "Cancel") : t("Modifier", "Edit")}
              </Button>
            )}
          </div>

          {!orgEditOpen ? (
            <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-text-muted">{t("Nom", "Name")}</dt>
                <dd className="mt-0.5">{organization?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Raison sociale", "Legal name")}</dt>
                <dd className="mt-0.5">{organization?.legalName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Secteur", "Line of business")}</dt>
                <dd className="mt-0.5">{organization?.type ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Type d'activité", "Type of business")}</dt>
                <dd className="mt-0.5">
                  {organization?.businessModel
                    ? `${businessModelText(BUSINESS_MODEL_DEFINITIONS[organization.businessModel], locale).label} · ${businessModelText(BUSINESS_MODEL_DEFINITIONS[organization.businessModel], locale).siteKind}`
                    : t("Non défini", "Not set")}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Pays", "Country")}</dt>
                <dd className="mt-0.5">{organization?.country ? countryName(organization.country, locale) : "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Devise", "Currency")}</dt>
                <dd className="mt-0.5">{organization?.currency ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Fuseau horaire", "Time zone")}</dt>
                <dd className="mt-0.5">{organization?.timezone ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Langue de votre site", "Website language")}</dt>
                <dd className="mt-0.5">
                  {organization?.language === "en" ? "English" : organization?.language === "fr" ? "Français" : (organization?.language ?? "—")}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Couleur de marque", "Brand colour")}</dt>
                <dd className="mt-0.5 flex items-center gap-2">
                  {organization?.brandColor ? (
                    <>
                      <span
                        className="inline-block h-4 w-4 rounded-full border border-border"
                        style={{ backgroundColor: organization.brandColor }}
                      />
                      {organization.brandColor}
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Slogan (page publique)", "Tagline (public page)")}</dt>
                <dd className="mt-0.5">{organization?.tagline ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Téléphone (page publique)", "Phone (public page)")}</dt>
                <dd className="mt-0.5">{organization?.contactPhone || "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("WhatsApp (page publique)", "WhatsApp (public page)")}</dt>
                <dd className="mt-0.5">{organization?.whatsappNumber || "—"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-text-muted">{t("Adresse (page publique)", "Address (public page)")}</dt>
                <dd className="mt-0.5">{organization?.contactAddress || "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t(
                  "Image de bannière (page publique)",
                  "Banner image (public page)",
                )}</dt>
                <dd className="mt-0.5 truncate">{organization?.heroImage ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Titre SEO (page publique)", "SEO title (public page)")}</dt>
                <dd className="mt-0.5">{organization?.seoTitle ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t(
                  "Description SEO (page publique)",
                  "SEO description (public page)",
                )}</dt>
                <dd className="mt-0.5">{organization?.seoDescription ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t("Domaine personnalisé", "Custom domain")}</dt>
                <dd className="mt-0.5">{organization?.customDomain ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">{t(
                  "Frais de livraison (boutique en ligne)",
                  "Delivery fee (online shop)",
                )}</dt>
                <dd className="mt-0.5">
                  {organization?.shippingFlatRate != null
                    ? `${organization.shippingFlatRate} ${organization.currency}`
                    : t("Gratuit", "Free")}
                </dd>
              </div>
              <div>
                <dt className="text-text-muted">{t(
                  "Sections visibles (page publique)",
                  "Sections shown (public page)",
                )}</dt>
                <dd className="mt-0.5">
                  {organization?.storefrontSections
                    ? organization.storefrontSections
                        .map((s) => (s === "catalog" ? t("Catalogue", "Catalogue") : t("Réservations", "Bookings")))
                        .join(", ") || t("Aucune", "None")
                    : t("Toutes", "All")}
                </dd>
              </div>
              {organization?.enabledModules.includes("commerce") && (
                <div>
                  <dt className="text-text-muted">{t("Moyens de paiement acceptés", "Accepted payment methods")}</dt>
                  <dd className="mt-0.5">
                    {(organization.acceptedPaymentMethods ?? ["cash"])
                      .map((m) => (m === "cash" ? t("Espèces / à la livraison", "Cash / on delivery") : t("En ligne", "Online")))
                      .join(", ")}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <form
              onSubmit={handleOrgSubmit((values) => {
                const needsTerms =
                  values.acceptedPaymentMethods?.includes("online") &&
                  !onlinePaymentTermsAccepted(organization?.onlinePaymentTerms);
                if (needsTerms && !acceptOnlineTerms) {
                  setTermsMissing(true);
                  return;
                }
                setTermsMissing(false);
                updateOrgMutation.mutate({
                  ...values,
                  ...(needsTerms ? { acceptOnlinePaymentTerms: ONLINE_PAYMENT_TERMS_VERSION } : {}),
                });
              })}
              className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-2"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-name">
                  {t("Nom", "Name")}
                </label>
                <Input
                  id="org-name"
                  className="w-full"
                  error={!!orgErrors.name}
                  {...registerOrg("name")}
                />
                {orgErrors.name && (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.name.message}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-legal-name">
                  {t("Raison sociale", "Legal name")}
                </label>
                <Input id="org-legal-name" className="w-full" {...registerOrg("legalName")} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-type">
                  {t("Secteur d'activité", "Line of business")}
                </label>
                <Input
                  id="org-type"
                  className="w-full"
                  placeholder={t("ex: commerce, service, réservation...", "e.g. retail, service, booking...")}
                  error={!!orgErrors.type}
                  {...registerOrg("type")}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-business-model">
                  {t("Type d'activité", "Type of business")}
                </label>
                <Select
                  id="org-business-model"
                  className="w-full"
                  {...registerOrg("businessModel", {
                    // Left unchosen on an older organization: send nothing rather than "".
                    setValueAs: (v: string | undefined) => (v ? v : undefined),
                  })}
                >
                  <option value="">{t("Non défini", "Not set")}</option>
                  {BUSINESS_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {businessModelText(BUSINESS_MODEL_DEFINITIONS[model], locale).label} —{" "}
                      {businessModelText(BUSINESS_MODEL_DEFINITIONS[model], locale).siteKind}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-country">
                  {t("Pays", "Country")}
                </label>
                <Select id="org-country" className="w-full" {...registerOrg("country")}>
                  {COUNTRIES.map((code) => (
                    <option key={code} value={code}>
                      {countryName(code, locale)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-currency">
                  {t("Devise", "Currency")}
                </label>
                <Select id="org-currency" className="w-full" {...registerOrg("currency")}>
                  {CURRENCIES.map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-timezone">
                  {t("Fuseau horaire", "Time zone")}
                </label>
                <Select id="org-timezone" className="w-full" {...registerOrg("timezone")}>
                  {TIMEZONES.map((timezone) => (
                    <option key={timezone} value={timezone}>
                      {timezone}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-language">
                  {t("Langue de votre site et des messages clients", "Language of your website and customer messages")}
                </label>
                <Select id="org-language" className="w-full" {...registerOrg("language")}>
                  <option value="fr">Français</option>
                  <option value="en">English</option>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-brand-color">
                  {t("Couleur de marque", "Brand colour")}
                </label>
                {/* setValueAs: brandColor/logo are optional but format-constrained (hex/url) —
                    an uncontrolled input left untouched by the user always submits "" (never
                    `undefined`, regardless of what reset() set as the default), which fails the
                    regex/.url() check even though the field is meant to be skippable. Converting
                    "" to undefined here is what actually makes it skippable. */}
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={t("Choisir la couleur de marque", "Choose the brand colour")}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-border-input bg-transparent p-0.5"
                    value={/^#([0-9a-fA-F]{6})$/.test(watchedBrandColor ?? "") ? watchedBrandColor! : "#1a73e8"}
                    onChange={(event) => setOrgValue("brandColor", event.target.value, { shouldDirty: true })}
                  />
                  <Input
                    id="org-brand-color"
                    className="w-full"
                    placeholder="#1a73e8"
                    error={!!orgErrors.brandColor}
                    {...registerOrg("brandColor", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
                  />
                </div>
                {orgErrors.brandColor && (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.brandColor.message}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-logo">
                  {t("Logo", "Logo")}
                </label>
                <div className="flex items-center gap-3">
                  {watchedLogo && (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary/uploaded URL, not a static asset
                    <img src={watchedLogo} alt="" className="h-10 w-10 rounded object-contain" />
                  )}
                  <Input
                    id="org-logo"
                    className="w-full"
                    placeholder={t("https://... ou envoyez un fichier", "https://... or upload a file")}
                    error={!!orgErrors.logo}
                    {...registerOrg("logo", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
                  />
                  <input
                    ref={logoFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label={t("Envoyer un fichier pour le logo", "Upload a file for the logo")}
                    onChange={(event) => {
                      void handleImageUpload("logo", event.target.files?.[0], setLogoUploading);
                      event.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    loading={logoUploading}
                    onClick={() => logoFileInputRef.current?.click()}
                  >
                    {t("Envoyer", "Send")}
                  </Button>
                </div>
                {orgErrors.logo && (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.logo.message}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-tagline">
                  {t("Slogan (affiché sur votre page publique)", "Tagline (shown on your public page)")}
                </label>
                <Input
                  id="org-tagline"
                  className="w-full"
                  placeholder={t("ex: Le meilleur salon de la ville", "e.g. The best salon in town")}
                  error={!!orgErrors.tagline}
                  {...registerOrg("tagline", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
                />
                {orgErrors.tagline && (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.tagline.message}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-contact-phone">
                  {t("Téléphone (affiché sur votre site)", "Phone (shown on your website)")}
                </label>
                <Input
                  id="org-contact-phone"
                  className="w-full"
                  type="tel"
                  placeholder={t("ex: 27 22 00 00 00", "e.g. 27 22 00 00 00")}
                  error={!!orgErrors.contactPhone}
                  {...registerOrg("contactPhone")}
                />
                {orgErrors.contactPhone && (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.contactPhone.message}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-whatsapp">
                  {t("Numéro WhatsApp", "WhatsApp number")}
                </label>
                <Input
                  id="org-whatsapp"
                  className="w-full"
                  type="tel"
                  placeholder={t("ex: +225 07 07 07 07 07", "e.g. +225 07 07 07 07 07")}
                  error={!!orgErrors.whatsappNumber}
                  {...registerOrg("whatsappNumber")}
                />
                {orgErrors.whatsappNumber ? (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.whatsappNumber.message}</p>
                ) : (
                  <p className="mt-1 text-xs text-text-muted">
                    {t(
                      "Vos clients pourront vous écrire et commander sur WhatsApp depuis votre site.",
                      "Your customers will be able to message you and order on WhatsApp from your website.",
                    )}
                  </p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-contact-address">
                  {t("Adresse (affichée sur votre site)", "Address (shown on your website)")}
                </label>
                <Input
                  id="org-contact-address"
                  className="w-full"
                  placeholder={t(
                    "ex: Rue des Jardins, Cocody, Abidjan",
                    "e.g. Rue des Jardins, Cocody, Abidjan",
                  )}
                  error={!!orgErrors.contactAddress}
                  {...registerOrg("contactAddress")}
                />
                {orgErrors.contactAddress && (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.contactAddress.message}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-seo-title">
                  {t(
                    "Titre SEO (balise <title> de la page publique)",
                    "SEO title (the public page's <title> tag)",
                  )}
                </label>
                <Input
                  id="org-seo-title"
                  className="w-full"
                  placeholder={organization?.name || t(
                    "Laissez vide pour utiliser le nom de l'organisation",
                    "Leave empty to use the organization's name",
                  )}
                  error={!!orgErrors.seoTitle}
                  {...registerOrg("seoTitle", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
                />
                {orgErrors.seoTitle && (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.seoTitle.message}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-seo-description">
                  {t(
                    "Description SEO (meta description de la page publique)",
                    "SEO description (the public page's meta description)",
                  )}
                </label>
                <textarea
                  id="org-seo-description"
                  className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
                  rows={2}
                  maxLength={200}
                  placeholder={t(
                    "Laissez vide pour générer une description automatiquement",
                    "Leave empty to generate a description automatically",
                  )}
                  {...registerOrg("seoDescription", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
                />
                {orgErrors.seoDescription && (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.seoDescription.message}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-custom-domain">
                  {t("Domaine personnalisé (optionnel)", "Custom domain (optional)")}
                </label>
                <Input
                  id="org-custom-domain"
                  className="w-full"
                  placeholder="www.mon-entreprise.com"
                  error={!!orgErrors.customDomain}
                  {...registerOrg("customDomain", {
                    setValueAs: (v: string) => (v === "" ? undefined : v),
                  })}
                />
                {orgErrors.customDomain && (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.customDomain.message}</p>
                )}
                <p className="mt-1 text-xs text-text-muted">
                  {t(
                    "Chez votre fournisseur de domaine, ajoutez un enregistrement CNAME pointant ce domaine vers",
                    "At your domain provider, add a CNAME record pointing this domain to",
                  )}{" "}
                  <span className="font-mono">{storefrontDomainCnameTarget}</span>.{" "}
                  {t(
                    "Sans « https:// » ni chemin — juste le nom de domaine.",
                    "No “https://” and no path — just the domain name.",
                  )}
                </p>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-hero-image">
                  {t("Image de bannière (page publique)", "Banner image (public page)")}
                </label>
                <div className="flex items-center gap-3">
                  {watchedHeroImage && (
                    // eslint-disable-next-line @next/next/no-img-element -- arbitrary/uploaded URL, not a static asset
                    <img src={watchedHeroImage} alt="" className="h-10 w-16 rounded object-cover" />
                  )}
                  <Input
                    id="org-hero-image"
                    className="w-full"
                    placeholder={t("https://... ou envoyez un fichier", "https://... or upload a file")}
                    error={!!orgErrors.heroImage}
                    {...registerOrg("heroImage", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
                  />
                  <input
                    ref={heroImageFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    aria-label={t("Envoyer un fichier pour la bannière", "Upload a file for the banner")}
                    onChange={(event) => {
                      void handleImageUpload("heroImage", event.target.files?.[0], setHeroImageUploading);
                      event.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0"
                    loading={heroImageUploading}
                    onClick={() => heroImageFileInputRef.current?.click()}
                  >
                    {t("Envoyer", "Send")}
                  </Button>
                </div>
                {orgErrors.heroImage && (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.heroImage.message}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-shipping-flat-rate">
                  {t("Frais de livraison (boutique en ligne)", "Delivery fee (online shop)")}
                </label>
                <Input
                  id="org-shipping-flat-rate"
                  type="number"
                  step="0.01"
                  className="w-full"
                  placeholder={t("Gratuit", "Free")}
                  error={!!orgErrors.shippingFlatRate}
                  {...registerOrg("shippingFlatRate", {
                    setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
                  })}
                />
                {orgErrors.shippingFlatRate && (
                  <p className="mt-1 text-xs text-destructive">{orgErrors.shippingFlatRate.message}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <StorefrontThemePicker
                  planKey={subscription?.plan.key}
                  selectedTemplate={watchedStorefrontTemplate}
                  selectedPalette={watchedStorefrontPalette}
                  selectedFontPairing={watchedStorefrontFontPairing}
                  onChangeTemplate={(key) => setOrgValue("storefrontTemplate", key, { shouldDirty: true })}
                  onChangePalette={(key) => setOrgValue("storefrontPalette", key, { shouldDirty: true })}
                  onChangeFontPairing={(key) => setOrgValue("storefrontFontPairing", key, { shouldDirty: true })}
                />
              </div>

              {(organization?.enabledModules.includes("catalog") ||
                organization?.enabledModules.includes("booking")) && (
                <div className="sm:col-span-2">
                  <p className="mb-1 text-xs font-medium text-text">
                    {t("Sections visibles sur la page publique", "Sections shown on the public page")}
                  </p>
                  <div className="flex flex-wrap gap-4">
                    {organization.enabledModules.includes("catalog") && (
                      <label className="flex items-center gap-2 text-sm text-text">
                        <input
                          type="checkbox"
                          value="catalog"
                          {...registerOrg("storefrontSections")}
                        />
                        {t("Afficher le catalogue", "Show the catalogue")}
                      </label>
                    )}
                    {organization.enabledModules.includes("booking") && (
                      <label className="flex items-center gap-2 text-sm text-text">
                        <input
                          type="checkbox"
                          value="booking"
                          {...registerOrg("storefrontSections")}
                        />
                        {t("Afficher les réservations", "Show bookings")}
                      </label>
                    )}
                  </div>
                </div>
              )}

              {organization?.enabledModules.includes("commerce") && (
                <div className="sm:col-span-2">
                  <p className="mb-1 text-xs font-medium text-text">
                    {t("Comment vos clients paient-ils ?", "How do your customers pay?")}
                  </p>
                  <p className="mb-1 text-xs text-text-muted">
                    {t(
                      "À vous de choisir : les espèces seules, sans aucune commission, ou aussi le paiement en ligne KORVA, avec la commission de votre formule.",
                      "Your choice: cash only, with no commission at all, or KORVA online payment too, with your plan's commission.",
                    )}
                  </p>
                  <p className="mb-2 text-xs text-text-muted">
                    {t(
                      "\"En ligne\" ne s'affiche à vos clients que si un moyen de paiement réel est connecté (voir Intégrations) — cochez-le dès maintenant si vous comptez en connecter un.",
                      "“Online” only shows to your customers once a real payment method is connected (see Integrations) — tick it now if you plan to connect one.",
                    )}
                  </p>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        value="cash"
                        {...registerOrg("acceptedPaymentMethods")}
                      />
                      {t("Espèces, à la livraison, au retrait ou sur place (sans commission)", "Cash, on delivery, collection or in person (no commission)")}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        value="online"
                        // Turning it on needs a paid plan; one already on stays as it is.
                        disabled={
                          !planFeatures.has("online_payment") &&
                          !organization?.acceptedPaymentMethods?.includes("online")
                        }
                        {...registerOrg("acceptedPaymentMethods")}
                      />
                      {t(
                        "Paiement en ligne : mobile money (Wave, Orange Money, MTN, Moov) et carte",
                        "Online payment: mobile money (Wave, Orange Money, MTN, Moov) and card",
                      )}
                      {!planFeatures.has("online_payment") && <PlanLock feature="online_payment" />}
                    </label>
                  </div>
                  {organization?.currency && watchedPaymentMethods?.includes("online") && (
                    <div className="mt-2 space-y-2 rounded-md border border-border p-3">
                      <OnlinePaymentFees
                        currency={organization.currency}
                        plan={(planFeatures.planKey as PlanKey | undefined) ?? "free"}
                      />
                      {onlinePaymentTermsAccepted(organization.onlinePaymentTerms) ? (
                        <p className="text-xs text-text-muted">
                          {t(
                            `Conditions du paiement en ligne acceptées le ${new Date(organization.onlinePaymentTerms!.acceptedAt).toLocaleDateString(intlLocale(locale))}.`,
                            `Online payment terms accepted on ${new Date(organization.onlinePaymentTerms!.acceptedAt).toLocaleDateString(intlLocale(locale))}.`,
                          )}{" "}
                          <a href={locale === "en" ? "/en/terms/online-payment" : "/conditions/paiement-en-ligne"} target="_blank" rel="noreferrer" className="underline">
                            {t("Relire", "Read again")}
                          </a>
                        </p>
                      ) : (
                        <label className="flex items-start gap-2 text-sm text-text">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={acceptOnlineTerms}
                            onChange={(event) => {
                              setAcceptOnlineTerms(event.target.checked);
                              if (event.target.checked) setTermsMissing(false);
                            }}
                          />
                          <span>
                            {t("J'ai lu et j'accepte les ", "I have read and accept the ")}
                            <a href={locale === "en" ? "/en/terms/online-payment" : "/conditions/paiement-en-ligne"} target="_blank" rel="noreferrer" className="underline">
                              {t("conditions du paiement en ligne", "online payment terms")}
                            </a>
                            {t(" (frais, commission, délais, retraits, remboursements).", " (fees, commission, delays, withdrawals, refunds).")}
                          </span>
                        </label>
                      )}
                      {termsMissing && (
                        <p className="text-xs text-destructive">
                          {t(
                            "Acceptez les conditions du paiement en ligne pour le proposer à vos clients, ou décochez-le pour rester aux espèces.",
                            "Accept the online payment terms to offer it to your customers, or untick it to stay with cash.",
                          )}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {uploadError && (
                <p className="text-sm text-destructive sm:col-span-2">{uploadError}</p>
              )}

              {updateOrgMutation.isError && (
                <p className="text-sm text-destructive sm:col-span-2">
                  {updateOrgMutation.error instanceof ApiError
                    ? updateOrgMutation.error.message
                    : t(
                      "Impossible d'enregistrer les informations de l'organisation.",
                      "The organization's details could not be saved.",
                    )}
                </p>
              )}

              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" loading={updateOrgMutation.isPending}>
                  {updateOrgMutation.isPending ? t("Enregistrement...", "Saving...") : t("Enregistrer", "Save")}
                </Button>
                <Button type="button" variant="ghost" onClick={cancelOrgEdit}>
                  {t("Annuler", "Cancel")}
                </Button>
              </div>
            </form>
          )}
        </section>

        {organization && <LoyaltySettings organization={organization} />}
      </SettingsTabPanel>

      <SettingsTabPanel tab="site" active={activeTab}>
        {organization?.slug && (
          <StorefrontPreviewSection
            slug={organization.slug}
            previewTemplate={orgEditOpen ? watchedStorefrontTemplate : undefined}
            previewPalette={orgEditOpen ? watchedStorefrontPalette : undefined}
            previewFontPairing={orgEditOpen ? watchedStorefrontFontPairing : undefined}
          />
        )}

        {organization?.enabledModules.includes("commerce") && (
          <OrderReceptionSettings key={organization.id} organization={organization} />
        )}

        {organization?.enabledModules.includes("booking") && organization.businessModel === "lodging" && (
          <StaySettings key={organization.id} organization={organization} />
        )}

        <StorefrontContentSection />

        {organization && <ExternalWebsiteSection slug={organization.slug} />}
      </SettingsTabPanel>

      <SettingsTabPanel tab="abonnement" active={activeTab}>
        <section className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-text">{t("Abonnement", "Subscription")}</h2>
          {subscription && (
            <div className="mt-4 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">
                    {subscription.plan.name}
                    {planFeatures.trialEndsAt && (
                      <span className="ml-2 text-xs font-normal text-text-muted">
                        essai offert jusqu&apos;au{" "}
                        {new Date(planFeatures.trialEndsAt).toLocaleDateString(intlLocale(locale))}, puis
                        formule Gratuite si vous ne choisissez rien
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-text-muted">
                    {subscription.plan.priceAmount} {subscription.plan.priceCurrency} / {subscription.plan.interval === "month" ? "mois" : "an"}
                  </p>
                </div>
                <Badge variant="success">
                  {subscription.subscription.status === "active" ? t("Actif", "Active") : subscription.subscription.status}
                </Badge>
              </div>

              <div className="space-y-2">
                {subscription.usage.map((item) => (
                  <div key={item.metric} className="text-xs">
                    <div className="mb-1 flex justify-between text-text-muted">
                      <span>{(METRIC_LABELS[item.metric] ? t(...METRIC_LABELS[item.metric]!) : item.metric)}</span>
                      <span>
                        {item.used} / {item.limit === -1 ? t("illimité", "unlimited") : item.limit}
                      </span>
                    </div>
                    {item.limit !== -1 && (
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                        <div
                          className="h-full rounded-full bg-sidebar"
                          style={{ width: `${Math.min(100, (item.used / item.limit) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {changePlanMutation.data?.paymentRequired && (
                <Notice tone="accent">
                  {t(
                    "Réglez la facture ci-dessous : la nouvelle formule s'active dès le paiement confirmé.",
                    "Pay the invoice below: the new plan starts as soon as the payment is confirmed.",
                  )}
                </Notice>
              )}
              {changePlanMutation.isError && (
                <p className="text-xs text-destructive">
                  {changePlanMutation.error instanceof ApiError
                    ? changePlanMutation.error.message
                    : t("Erreur", "Error")}
                </p>
              )}

              {aiUsage && !aiUsagePermissionDenied && (
                <div className="border-t border-border pt-4">
                  <div className="mb-1 flex justify-between text-xs text-text-muted">
                    <span>Coût IA ce mois-ci ({aiUsage.period})</span>
                    <span>{formatCurrency(aiUsage.costUsd, "USD", locale)}</span>
                  </div>
                  <p className="text-xs text-text-muted">
                    {(aiUsage.inputTokens + aiUsage.outputTokens).toLocaleString(intlLocale(locale))} tokens
                    {aiUsage.unpricedCalls > 0 && (
                      <> · {aiUsage.unpricedCalls} appel{aiUsage.unpricedCalls > 1 ? "s" : ""} non tarifé{aiUsage.unpricedCalls > 1 ? "s" : ""}</>
                    )}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 border-t border-border pt-4 sm:grid-cols-4">
                {plans?.map((plan) => (
                  <div key={plan.id} className="rounded-md border border-border p-3 text-xs">
                    <p className="font-medium">{plan.name}</p>
                    <p className="mt-0.5 text-text-muted">
                      {plan.priceAmount} {plan.priceCurrency}/mois
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-2 w-full disabled:cursor-default"
                      onClick={() => changePlanMutation.mutate(plan.key)}
                      disabled={plan.key === subscription.plan.key || changePlanMutation.isPending}
                    >
                      {plan.key === subscription.plan.key ? t("Plan actuel", "Current plan") : t("Choisir", "Choose")}
                    </Button>
                  </div>
                ))}
              </div>

              <KorvaPlanInvoices />
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">{t("Produits", "Products")}</h2>
            {productOverridesMutation.isPending && (
              <span className="text-xs text-text-muted">{t("Enregistrement...", "Saving...")}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {t(
              "KORVA CRM, Inventaire, Site web et Assistant IA peuvent être activés ou désactivés indépendamment. Une case cochée par défaut signifie que votre plan actuel inclut déjà ce produit ; désactiver ou forcer l'activation d'un produit met à jour les modules concernés ci-dessous.",
              "KORVA CRM, Inventory, Website and AI assistant can each be turned on or off. A box ticked by default means your current plan already includes that product; turning a product off or forcing it on updates the related modules below.",
            )}
          </p>

          {productOverridesMutation.isError && (
            <p className="mt-3 text-xs text-destructive">
              {productOverridesMutation.error instanceof ApiError
                ? productOverridesMutation.error.message
                : t(
                  "Impossible de mettre à jour les produits. Réessayez.",
                  "Products could not be updated. Try again.",
                )}
            </p>
          )}

          {!subscription ? (
            <p className="mt-4 text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {KORVA_PRODUCTS.map((product) => {
                const override = subscription.subscription.productOverrides?.[product];
                const isActive =
                  override ??
                  PRODUCT_MODULES[product].some((m) => subscription.plan.modules.includes(m));
                return (
                  <label
                    key={product}
                    htmlFor={`product-${product}`}
                    className={`flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm ${
                      productOverridesMutation.isPending ? "opacity-60" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        id={`product-${product}`}
                        type="checkbox"
                        checked={isActive}
                        disabled={productOverridesMutation.isPending}
                        onChange={() => toggleProduct(product, isActive)}
                        aria-label={t(...PRODUCT_ARIA_LABELS[product])}
                      />
                      {t(...PRODUCT_LABELS[product])}
                    </span>
                    {override === undefined && <Badge>{t("Défaut du plan", "Plan default")}</Badge>}
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border bg-surface p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">{t("Modules", "Modules")}</h2>
            {modulesMutation.isPending && (
              <span className="text-xs text-text-muted">{t("Enregistrement...", "Saving...")}</span>
            )}
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {t(
              "Activez ou désactivez les modules disponibles dans votre plan actuel. Le menu à gauche se met à jour immédiatement.",
              "Turn on or off the modules available in your current plan. The menu on the left updates straight away.",
            )}
          </p>

          {modulesMutation.isError && (
            <p className="mt-3 text-xs text-destructive">
              {modulesMutation.error instanceof ApiError
                ? modulesMutation.error.message
                : t(
                  "Impossible de mettre à jour les modules. Réessayez.",
                  "Modules could not be updated. Try again.",
                )}
            </p>
          )}

          {!organization || !subscription ? (
            <p className="mt-4 text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {KORVA_MODULES.map((module) => {
                const isEnabled = organization.enabledModules.includes(module);
                const isAllowedByPlan = resolveEffectiveModules(
                  subscription.plan.modules,
                  subscription.subscription.productOverrides,
                ).includes(module);
                // One sales channel on Free: the second of bookings/orders is locked until the
                // plan includes both (an organization already running both keeps them).
                const otherChannel =
                  module === "booking" ? "commerce" : module === "commerce" ? "booking" : null;
                const channelLocked =
                  otherChannel !== null &&
                  !isEnabled &&
                  organization.enabledModules.includes(otherChannel) &&
                  !planFeatures.has("both_channels");
                const disabled = !isAllowedByPlan || channelLocked || modulesMutation.isPending;
                return (
                  <label
                    key={module}
                    htmlFor={`module-${module}`}
                    className={`flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm ${
                      disabled ? "opacity-60" : ""
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <input
                        id={`module-${module}`}
                        type="checkbox"
                        checked={isEnabled}
                        disabled={disabled}
                        onChange={() => toggleModule(module)}
                      />
                      {t(...MODULE_LABELS[module])}
                    </span>
                    {!isAllowedByPlan && <Badge>{t("Non inclus dans le plan", "Not included in the plan")}</Badge>}
                    {isAllowedByPlan && channelLocked && <PlanLock feature="both_channels" />}
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {organization && <OtherToolsSettings organization={organization} />}
      </SettingsTabPanel>

      <SettingsTabPanel tab="equipe" active={activeTab}>
        <section className="rounded-lg border border-border bg-surface p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-text">{t("Utilisateurs", "Users")}</h2>
            <Button variant="secondary" size="sm" onClick={() => setInviteOpen((v) => !v)}>
              {inviteOpen ? t("Annuler", "Cancel") : t("Inviter un membre", "Invite a member")}
            </Button>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            {t(
              "Les personnes qui se connectent au tableau de bord. Vos coiffeurs, coachs ou formateurs réservables par vos clients n'ont pas besoin de compte : ajoutez-les dans Réservations › Équipe et ressources, sans utiliser d'utilisateur de votre abonnement.",
              "The people who sign in to the dashboard. Your hairdressers, coaches or trainers that customers book need no account: add them in Bookings › Team and resources, without using a user from your subscription.",
            )}
          </p>

          {inviteOpen && (
            <form
              onSubmit={handleInviteSubmit((values) => inviteMemberMutation.mutate(values))}
              className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-2"
            >
              <div>
                <label className="block text-sm font-medium text-text" htmlFor="invite-email">
                  {t("Adresse email", "Email address")}
                </label>
                <Input
                  id="invite-email"
                  type="email"
                  className="mt-1 w-full"
                  error={!!inviteErrors.email}
                  {...registerInvite("email")}
                />
                {inviteErrors.email && (
                  <p className="mt-1 text-xs text-destructive">{inviteErrors.email.message}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-text" htmlFor="invite-role">
                  {t("Rôle", "Role")}
                </label>
                <select
                  id="invite-role"
                  defaultValue=""
                  disabled={rolesLoading || rolesError || (roles?.length ?? 0) === 0}
                  className="mt-1 w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text focus:border-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                  {...registerInvite("roleId")}
                >
                  <option value="" disabled>
                    {rolesLoading
                      ? t("Chargement des rôles...", "Loading roles...")
                      : rolesError
                        ? t("Rôles indisponibles", "Roles unavailable")
                        : roles && roles.length === 0
                          ? t("Aucun rôle disponible", "No roles available")
                          : t("Sélectionner un rôle", "Select a role")}
                  </option>
                  {roles?.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name}
                    </option>
                  ))}
                </select>
                {rolesError && (
                  <div className="mt-1">
                    <p className="text-xs text-destructive">{t(
                      "Impossible de charger les rôles.",
                      "Roles could not be loaded.",
                    )}</p>
                    <button
                      type="button"
                      onClick={() => void refetchRoles()}
                      className="text-xs font-medium text-text underline"
                    >
                      {t("Réessayer", "Try again")}
                    </button>
                  </div>
                )}
                {inviteErrors.roleId && (
                  <p className="mt-1 text-xs text-destructive">{inviteErrors.roleId.message}</p>
                )}
              </div>

              {inviteMemberMutation.isError && (
                <p className="text-sm text-destructive sm:col-span-2">
                  {inviteMemberMutation.error instanceof ApiError
                    ? inviteMemberMutation.error.message
                    : t(
                      "Impossible d'envoyer l'invitation. Réessayez.",
                      "The invitation could not be sent. Try again.",
                    )}
                </p>
              )}

              {inviteMemberMutation.isSuccess && (
                <p className="text-sm text-text sm:col-span-2">
                  {t(
                    "Invitation envoyée par email. Elle apparaîtra ci-dessous jusqu'à ce qu'elle soit acceptée.",
                    "Invitation sent by email. It shows below until it is accepted.",
                  )}
                </p>
              )}

              <Button
                type="submit"
                className="sm:col-span-2"
                loading={inviteMemberMutation.isPending}
                disabled={rolesLoading || rolesError || (roles?.length ?? 0) === 0}
              >
                {inviteMemberMutation.isPending ? t("Invitation en cours...", "Inviting...") : t("Envoyer l'invitation", "Send the invitation")}
              </Button>
            </form>
          )}

          <div className="mt-4 divide-y divide-border">
            {isLoading && <p className="py-2 text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>}
            {members
              ?.filter((member) => member.status === "active")
              .map((member) => {
                const isSelf = member.userId.id === currentUserId;
                const isRoleChangePending =
                  updateMemberRoleMutation.isPending &&
                  updateMemberRoleMutation.variables?.id === member.id;
                const roleChangeError =
                  updateMemberRoleMutation.isError &&
                  updateMemberRoleMutation.variables?.id === member.id
                    ? updateMemberRoleMutation.error
                    : null;
                const isRemoveConfirming = removeConfirmId === member.id;
                const isRemovePending =
                  removeMemberMutation.isPending && removeMemberMutation.variables === member.id;
                const removeError =
                  removeMemberMutation.isError && removeMemberMutation.variables === member.id
                    ? removeMemberMutation.error
                    : null;
                return (
                  <div key={member.id} className="py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {member.userId.firstName
                            ? `${member.userId.firstName} ${member.userId.lastName ?? ""}`.trim()
                            : member.userId.email}
                          {isSelf && <span className="text-xs text-text-muted"> {t("(vous)", "(you)")}</span>}
                        </p>
                        <p className="text-xs text-text-muted">{member.userId.email}</p>
                      </div>
                      {isSelf ? (
                        <Badge>{member.roleId.name}</Badge>
                      ) : (
                        <div className="flex items-center gap-2">
                          <select
                            value={member.roleId.id}
                            disabled={isRoleChangePending}
                            onChange={(e) =>
                              updateMemberRoleMutation.mutate({ id: member.id, roleId: e.target.value })
                            }
                            className="rounded-md border border-border-input bg-surface px-2 py-1 text-xs text-text focus:border-focus focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {roles?.map((role) => (
                              <option key={role.id} value={role.id}>
                                {role.name}
                              </option>
                            ))}
                          </select>
                          {isRemoveConfirming ? (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={isRemovePending}
                                onClick={() => removeMemberMutation.mutate(member.id)}
                              >
                                {isRemovePending ? t("Retrait...", "Removing...") : t("Confirmer ?", "Confirm?")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isRemovePending}
                                onClick={() => setRemoveConfirmId(null)}
                              >
                                {t("Annuler", "Cancel")}
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setRemoveConfirmId(member.id)}
                            >
                              {t("Retirer", "Remove")}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                      <label htmlFor={`rate-${member.id}`}>{t("Taux horaire par défaut", "Default hourly rate")}</label>
                      <Input
                        id={`rate-${member.id}`}
                        type="number"
                        step="0.01"
                        className="h-7 w-24 py-1 text-xs"
                        defaultValue={member.defaultHourlyRate ?? ""}
                        disabled={
                          updateMemberRateMutation.isPending &&
                          updateMemberRateMutation.variables?.id === member.id
                        }
                        onBlur={(e) => {
                          const value = e.target.value === "" ? undefined : Number(e.target.value);
                          if (value !== undefined && value > 0 && value !== member.defaultHourlyRate) {
                            updateMemberRateMutation.mutate({ id: member.id, defaultHourlyRate: value });
                          }
                        }}
                      />
                      {updateMemberRateMutation.isError &&
                        updateMemberRateMutation.variables?.id === member.id && (
                          <span className="text-destructive">
                            {updateMemberRateMutation.error instanceof ApiError
                              ? updateMemberRateMutation.error.message
                              : t("Erreur", "Error")}
                          </span>
                        )}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                      <label htmlFor={`commission-${member.id}`}>{t("Commission (%)", "Commission (%)")}</label>
                      <Input
                        id={`commission-${member.id}`}
                        type="number"
                        step="0.1"
                        min={0}
                        max={100}
                        className="h-7 w-20 py-1 text-xs"
                        defaultValue={
                          member.commissionRateBasisPoints !== undefined
                            ? member.commissionRateBasisPoints / 100
                            : ""
                        }
                        disabled={
                          updateMemberCommissionRateMutation.isPending &&
                          updateMemberCommissionRateMutation.variables?.id === member.id
                        }
                        onBlur={(e) => {
                          const percent = e.target.value === "" ? undefined : Number(e.target.value);
                          if (percent !== undefined && percent >= 0 && percent <= 100) {
                            const basisPoints = Math.round(percent * 100);
                            if (basisPoints !== member.commissionRateBasisPoints) {
                              updateMemberCommissionRateMutation.mutate({
                                id: member.id,
                                commissionRateBasisPoints: basisPoints,
                              });
                            }
                          }
                        }}
                      />
                      {updateMemberCommissionRateMutation.isError &&
                        updateMemberCommissionRateMutation.variables?.id === member.id && (
                          <span className="text-destructive">
                            {updateMemberCommissionRateMutation.error instanceof ApiError
                              ? updateMemberCommissionRateMutation.error.message
                              : t("Erreur", "Error")}
                          </span>
                        )}
                    </div>
                    {roleChangeError && (
                      <p className="mt-1 text-xs text-destructive">
                        {roleChangeError instanceof ApiError
                          ? roleChangeError.message
                          : t("Impossible de modifier le rôle.", "The role could not be changed.")}
                      </p>
                    )}
                    {removeError && (
                      <p className="mt-1 text-xs text-destructive">
                        {removeError instanceof ApiError
                          ? removeError.message
                          : t("Impossible de retirer ce membre.", "This member could not be removed.")}
                      </p>
                    )}
                  </div>
                );
              })}
          </div>

          {pendingInvitations && pendingInvitations.length > 0 && (
            <div className="mt-4">
              <h3 className="text-xs font-semibold text-text-muted">
                {t("Invitations en attente", "Pending invitations")}
              </h3>
              <div className="mt-2 divide-y divide-border">
                {pendingInvitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex items-center justify-between py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-xs text-text-muted">
                        Expire le {new Date(invitation.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="warning">
                      {roles?.find((role) => role.id === invitation.roleId)?.name ?? t("En attente", "Pending")}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <RolesManagementSection />
      </SettingsTabPanel>

      <SettingsTabPanel tab="integrations" active={activeTab}>
        <section className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-text">{t("Intégrations", "Integrations")}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {t(
              "Connectez les services externes utilisés par votre organisation.",
              "Connect the outside services your organization uses.",
            )}
          </p>

          {integrationsPermissionDenied ? (
            <p className="mt-4 text-sm text-text-muted">
              {t(
                "Les intégrations sont réservées aux administrateurs.",
                "Integrations are for administrators only.",
              )}
            </p>
          ) : integrationsLoading ? (
            <p className="mt-4 text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
          ) : integrationsIsError ? (
            <div className="mt-4">
              <p className="text-sm text-destructive">
                {integrationsError instanceof ApiError
                  ? integrationsError.message
                  : t("Impossible de charger les intégrations.", "Integrations could not be loaded.")}
              </p>
              <button
                type="button"
                onClick={() => void refetchIntegrations()}
                className="mt-1 text-sm font-medium text-text underline"
              >
                {t("Réessayer", "Try again")}
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {INTEGRATION_SLOTS.map((slot) => {
                const integration = integrations?.find((i) => i.domain === slot.domain);
                const isFormOpen = slot.domain === "payment" ? paymentFormOpen : messagingFormOpen;
                const isConfirmingDisconnect =
                  !!integration && disconnectConfirmId === integration.id;
                const isTestingThis =
                  testConnectionMutation.isPending &&
                  testConnectionMutation.variables === integration?.id;
                const testResult =
                  integration && testConnectionMutation.variables === integration.id
                    ? testConnectionMutation.data
                    : undefined;
                const testError =
                  integration &&
                  testConnectionMutation.isError &&
                  testConnectionMutation.variables === integration.id
                    ? testConnectionMutation.error
                    : null;
                const isDisconnectPending =
                  disconnectMutation.isPending && disconnectMutation.variables === integration?.id;
                const disconnectError =
                  integration &&
                  disconnectMutation.isError &&
                  disconnectMutation.variables === integration.id
                    ? disconnectMutation.error
                    : null;
                // Once connected, name the ACTUAL resolved provider (market-driven server-side,
                // see PAYMENT_PROVIDER_DISPLAY_NAMES's own doc) rather than the pre-connection
                // slot's deliberately provider-agnostic default copy.
                const providerName =
                  integration && slot.domain === "payment"
                    ? paymentProviderDisplayName(integration.provider, locale)
                    : undefined;
                const title = providerName ? `${t(...slot.title)} — ${providerName}` : t(...slot.title);
                const description = providerName
                  ? t(`Recevez vos règlements via ${providerName}.`, `Get paid through ${providerName}.`)
                  : t(...slot.description);

                return (
                  <div key={slot.domain} className="rounded-md border border-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-text">{title}</p>
                        <p className="text-xs text-text-muted">{description}</p>
                      </div>
                      <Badge
                        variant={
                          integration
                            ? INTEGRATION_STATUS_BADGE[integration.status].variant
                            : "default"
                        }
                      >
                        {integration
                          ? t(...INTEGRATION_STATUS_BADGE[integration.status].label)
                          : t("Non connecté", "Not connected")}
                      </Badge>
                    </div>

                    {integration && (integration.market || integration.lastVerifiedAt) && (
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-muted">
                        {integration.market && (
                          <div>
                            <dt>{t(...slot.connectedLabel)}</dt>
                            <dd className="text-text">{integration.market}</dd>
                          </div>
                        )}
                        {integration.lastVerifiedAt && (
                          <div>
                            <dt>{t("Dernière vérification", "Last check")}</dt>
                            <dd className="text-text">
                              {new Date(integration.lastVerifiedAt).toLocaleString(intlLocale(locale))}
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}

                    {integration?.lastErrorMessage && (
                      <p className="mt-2 text-xs text-destructive">
                        {integration.lastErrorMessage}
                      </p>
                    )}

                    {testResult && (
                      <p
                        className={`mt-2 text-xs ${testResult.ok ? "text-success" : "text-destructive"}`}
                      >
                        {testResult.message ??
                          (testResult.ok ? t("Connexion réussie.", "Connected.") : t("Échec de la connexion.", "Connection failed."))}
                      </p>
                    )}
                    {testError && (
                      <p className="mt-2 text-xs text-destructive">
                        {testError instanceof ApiError
                          ? testError.message
                          : t("Impossible de tester la connexion.", "The connection could not be tested.")}
                      </p>
                    )}
                    {disconnectError && (
                      <p className="mt-2 text-xs text-destructive">
                        {disconnectError instanceof ApiError
                          ? disconnectError.message
                          : t(
                            "Impossible de déconnecter cette intégration.",
                            "This integration could not be disconnected.",
                          )}
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {!integration && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            slot.domain === "payment"
                              ? setPaymentFormOpen((v) => !v)
                              : setMessagingFormOpen((v) => !v)
                          }
                        >
                          {isFormOpen ? t("Annuler", "Cancel") : t("Connecter", "Connect")}
                        </Button>
                      )}
                      {integration && (
                        <>
                          <Button
                            variant="secondary"
                            size="sm"
                            loading={isTestingThis}
                            disabled={isConfirmingDisconnect}
                            onClick={() => testConnectionMutation.mutate(integration.id)}
                          >
                            {isTestingThis ? t("Test en cours...", "Testing...") : t("Tester la connexion", "Test the connection")}
                          </Button>
                          {isConfirmingDisconnect ? (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={isDisconnectPending}
                                onClick={() => disconnectMutation.mutate(integration.id)}
                              >
                                {isDisconnectPending ? t("Déconnexion...", "Disconnecting...") : t("Confirmer ?", "Confirm?")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isDisconnectPending}
                                onClick={() => setDisconnectConfirmId(null)}
                              >
                                {t("Annuler", "Cancel")}
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDisconnectConfirmId(integration.id)}
                            >
                              {t("Déconnecter", "Disconnect")}
                            </Button>
                          )}
                        </>
                      )}
                    </div>

                    {slot.domain === "payment" && !integration && paymentFormOpen && (
                      <form
                        onSubmit={handlePaymentSubmit(submitPaymentForm)}
                        className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-2"
                      >
                        <div>
                          <label
                            className="block text-sm font-medium text-text"
                            htmlFor="payout-account-bank"
                          >
                            {t("Code banque (Flutterwave)", "Bank code (Flutterwave)")}
                          </label>
                          <Input
                            id="payout-account-bank"
                            className="mt-1 w-full"
                            placeholder={t("ex : 044", "e.g. 044")}
                            error={!!paymentErrors.account_bank}
                            {...registerPayment("account_bank", { required: true })}
                          />
                          <p className="mt-1 text-xs text-text-muted">
                            {t(
                              "Code numérique de la banque chez Flutterwave, pas son nom.",
                              "The bank's number code at Flutterwave, not its name.",
                            )}
                          </p>
                        </div>
                        <div>
                          <label
                            className="block text-sm font-medium text-text"
                            htmlFor="payout-account-number"
                          >
                            {t("Numéro de compte", "Account number")}
                          </label>
                          <Input
                            id="payout-account-number"
                            className="mt-1 w-full"
                            error={!!paymentErrors.account_number}
                            {...registerPayment("account_number", { required: true })}
                          />
                        </div>
                        <div>
                          <label
                            className="block text-sm font-medium text-text"
                            htmlFor="payout-business-name"
                          >
                            {t("Nom de l'entreprise", "Company name")}
                          </label>
                          <Input
                            id="payout-business-name"
                            className="mt-1 w-full"
                            error={!!paymentErrors.business_name}
                            {...registerPayment("business_name", { required: true })}
                          />
                        </div>
                        <div>
                          <label
                            className="block text-sm font-medium text-text"
                            htmlFor="payout-country"
                          >
                            {t("Pays (code ISO)", "Country (ISO code)")}
                          </label>
                          <Input
                            id="payout-country"
                            className="mt-1 w-full"
                            placeholder={t("ex : CI", "e.g. CI")}
                            defaultValue={organization?.country}
                            error={!!paymentErrors.country}
                            {...registerPayment("country", { required: true })}
                          />
                        </div>
                        <div>
                          <label
                            className="block text-sm font-medium text-text"
                            htmlFor="payout-split-type"
                          >
                            {t("Type de répartition", "Split type")}
                          </label>
                          <select
                            id="payout-split-type"
                            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                            {...registerPayment("split_type", { required: true })}
                          >
                            <option value="percentage">{t("Pourcentage", "Percentage")}</option>
                            <option value="flat">{t("Montant fixe", "Fixed amount")}</option>
                          </select>
                        </div>
                        <div>
                          <label
                            className="block text-sm font-medium text-text"
                            htmlFor="payout-split-value"
                          >
                            {t("Valeur de répartition", "Split value")}
                          </label>
                          <Input
                            id="payout-split-value"
                            type="number"
                            step="any"
                            className="mt-1 w-full"
                            error={!!paymentErrors.split_value}
                            {...registerPayment("split_value", { required: true })}
                          />
                        </div>

                        {connectPaymentMutation.isError && (
                          <p className="text-sm text-destructive sm:col-span-2">
                            {connectPaymentMutation.error instanceof ApiError
                              ? connectPaymentMutation.error.message
                              : t(
                                "Impossible de connecter le compte de paiement.",
                                "The payment account could not be connected.",
                              )}
                          </p>
                        )}

                        <Button
                          type="submit"
                          className="sm:col-span-2"
                          loading={connectPaymentMutation.isPending}
                        >
                          {connectPaymentMutation.isPending ? t("Connexion...", "Connecting...") : t("Connecter", "Connect")}
                        </Button>
                      </form>
                    )}

                    {slot.domain === "messaging" && !integration && messagingFormOpen && (
                      <form
                        onSubmit={handleMessagingSubmit((values) =>
                          connectMessagingMutation.mutate(values),
                        )}
                        className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-2"
                      >
                        <p className="text-xs text-text-muted sm:col-span-2">
                          {t(
                            "Le WABA ID, l'ID du numéro de téléphone et la clé API proviennent de l'inscription WhatsApp Business que vous avez complétée directement chez 360dialog (embedded signup) — ces informations ne sont pas saisies ici pour la première fois.",
                            "The WABA ID, phone number ID and API key come from the WhatsApp Business sign-up you completed directly with 360dialog (embedded signup) — this is not where they are entered for the first time.",
                          )}
                        </p>
                        <div>
                          <label
                            className="block text-sm font-medium text-text"
                            htmlFor="waba-id"
                          >
                            {t("WABA ID", "WABA ID")}
                          </label>
                          <Input
                            id="waba-id"
                            className="mt-1 w-full"
                            error={!!messagingErrors.wabaId}
                            {...registerMessaging("wabaId", { required: true })}
                          />
                        </div>
                        <div>
                          <label
                            className="block text-sm font-medium text-text"
                            htmlFor="phone-number-id"
                          >
                            {t("ID du numéro de téléphone", "Phone number ID")}
                          </label>
                          <Input
                            id="phone-number-id"
                            className="mt-1 w-full"
                            error={!!messagingErrors.phoneNumberId}
                            {...registerMessaging("phoneNumberId", { required: true })}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label
                            className="block text-sm font-medium text-text"
                            htmlFor="waba-display-name"
                          >
                            {t("Nom affiché", "Display name")}
                          </label>
                          <Input
                            id="waba-display-name"
                            className="mt-1 w-full"
                            error={!!messagingErrors.displayName}
                            {...registerMessaging("displayName", { required: true })}
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label
                            className="block text-sm font-medium text-text"
                            htmlFor="waba-api-key"
                          >
                            {t("Clé API (D360-API-KEY)", "API key (D360-API-KEY)")}
                          </label>
                          <Input
                            id="waba-api-key"
                            type="password"
                            autoComplete="off"
                            className="mt-1 w-full"
                            error={!!messagingErrors.apiKey}
                            {...registerMessaging("apiKey", { required: true })}
                          />
                          <p className="mt-1 text-xs text-text-muted">
                            {t(
                              "Stockée chiffrée et jamais réaffichée ensuite — nécessaire pour tester la connexion et activer l'intégration.",
                              "Stored encrypted and never shown again — needed to test the connection and turn on the integration.",
                            )}
                          </p>
                        </div>

                        {connectMessagingMutation.isError && (
                          <p className="text-sm text-destructive sm:col-span-2">
                            {connectMessagingMutation.error instanceof ApiError
                              ? connectMessagingMutation.error.message
                              : t(
                                "Impossible de connecter le compte WhatsApp Business.",
                                "The WhatsApp Business account could not be connected.",
                              )}
                          </p>
                        )}

                        <Button
                          type="submit"
                          className="sm:col-span-2"
                          loading={connectMessagingMutation.isPending}
                        >
                          {connectMessagingMutation.isPending ? t("Connexion...", "Connecting...") : t("Connecter", "Connect")}
                        </Button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <WebhookSubscriptionsSection />

        {!sensitiveToolsPermissionDenied && sensitiveTools && sensitiveTools.length > 0 && (
          <section className="rounded-lg border border-border bg-surface p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text">{t("Autonomie de l'IA", "AI autonomy")}</h2>
              {autoApprovedToolsMutation.isPending && (
                <span className="text-xs text-text-muted">{t("Enregistrement...", "Saving...")}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {t(
                "Ces actions nécessitent normalement une confirmation humaine avant d'être exécutées par l'assistant IA. Cochez celles que vous autorisez à s'exécuter automatiquement, sans confirmation.",
                "These actions normally need a person to confirm them before the AI assistant runs them. Tick the ones you allow to run automatically, without confirmation.",
              )}
            </p>

            {autoApprovedToolsMutation.isError && (
              <p className="mt-2 text-xs text-destructive">
                {autoApprovedToolsMutation.error instanceof ApiError
                  ? autoApprovedToolsMutation.error.message
                  : t("Erreur", "Error")}
              </p>
            )}

            <div className="mt-4 space-y-2">
              {sensitiveTools.map((tool) => {
                const approved = organization?.aiAutoApprovedTools?.includes(tool.name) ?? false;
                return (
                  <label
                    key={tool.name}
                    className={`flex items-start gap-2 text-sm ${
                      autoApprovedToolsMutation.isPending ? "opacity-60" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={approved}
                      disabled={autoApprovedToolsMutation.isPending}
                      onChange={() => toggleAutoApprovedTool(tool.name, approved)}
                      aria-label={`Auto-approuver ${tool.name}`}
                    />
                    <span>
                      <span className="font-medium text-text">{tool.name}</span>
                      <span className="block text-xs text-text-muted">{tool.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </section>
        )}
      </SettingsTabPanel>

      <SettingsTabPanel tab="avance" active={activeTab}>
        <CustomFieldsSection />

        <AuditLogSection />
      </SettingsTabPanel>
    </div>
  );
}

interface RoleDetail {
  id: string;
  name: string;
  systemKey?: string;
  isSystem: boolean;
  permissions: string[];
}

/** Custom (organization-defined) role management — see apps/api/src/identity/roles/roles.controller.ts.
 *  System roles are listed for visibility but never editable/deletable here (the API itself
 *  refuses, this UI just doesn't offer the buttons for them). */
function RolesManagementSection() {
  const t = useT();
  const authReady = useAuthReady();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const planFeatures = usePlanFeatures();
  const { data: organization } = useActiveOrganization();
  // Business for new sign-ups; an organization created before the gate keeps it (and every
  // existing role stays editable whatever the plan).
  const canCreate =
    !planFeatures.planKey ||
    organizationHasFeature(planFeatures.planKey, "custom_roles", organization?.createdAt);
  const { data: roles, isLoading } = useQuery({
    queryKey: ["roles"],
    enabled: authReady,
    queryFn: () => apiClient.get<RoleDetail[]>("/roles"),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateRoleInput>({
    resolver: zodResolver(createRoleSchema),
    defaultValues: { name: "", permissions: [] },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateRoleInput) => apiClient.post<RoleDetail>("/roles", input),
    onSuccess: () => {
      reset({ name: "", permissions: [] });
      setCreateOpen(false);
      return queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/roles/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roles"] }),
  });

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text">{t("Rôles personnalisés", "Custom roles")}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {t(
              "En plus des 6 rôles standards, créez des rôles avec exactement les permissions dont vos équipes ont besoin.",
              "On top of the 6 standard roles, create roles with exactly the permissions your teams need.",
            )}
          </p>
        </div>
        {canCreate ? (
          <Button type="button" variant="secondary" size="sm" onClick={() => setCreateOpen((v) => !v)}>
            {createOpen ? t("Annuler", "Cancel") : t("Créer un rôle", "Create a role")}
          </Button>
        ) : (
          <PlanLock feature="custom_roles" />
        )}
      </div>

      {createOpen && canCreate && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="mt-4 space-y-3 rounded-md border border-border p-4"
        >
          <div>
            <Input placeholder={t("Nom du rôle", "Role name")} className="w-full" error={!!errors.name} {...register("name")} />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-text">{t("Permissions", "Permissions")}</p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {CORE_PERMISSIONS.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-xs text-text">
                  <input type="checkbox" value={permission} {...register("permissions")} />
                  {permission}
                </label>
              ))}
            </div>
          </div>
          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof ApiError
                ? createMutation.error.message
                : t("Impossible de créer ce rôle.", "This role could not be created.")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer le rôle", "Create the role")}
          </Button>
        </form>
      )}

      {isLoading ? (
        <p className="mt-4 text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {roles?.map((role) => (
            <li key={role.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-text">{role.name}</span>
                {role.isSystem ? (
                  <Badge>{t("Standard", "Standard")}</Badge>
                ) : (
                  <span className="text-xs text-text-muted">
                    {role.permissions.length} permission(s)
                  </span>
                )}
              </div>
              {!role.isSystem && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={deleteMutation.isPending && deleteMutation.variables === role.id}
                  onClick={() => deleteMutation.mutate(role.id)}
                >
                  {t("Supprimer", "Delete")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {deleteMutation.isError && (
        <p className="mt-2 text-sm text-destructive">
          {deleteMutation.error instanceof ApiError
            ? deleteMutation.error.message
            : t("Impossible de supprimer ce rôle.", "This role could not be deleted.")}
        </p>
      )}
    </section>
  );
}

const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, [string, string]> = {
  contacts: ["Contacts", "Contacts"],
  leads: ["Prospects", "Leads"],
  deals: ["Affaires", "Deals"],
  offers: ["Produits & services", "Products & services"],
  bookings: ["Réservations", "Bookings"],
  orders: ["Commandes", "Orders"],
  tickets: ["Tickets", "Tickets"],
};

const CUSTOM_FIELD_TYPE_LABELS: Record<CreateCustomFieldInput["type"], [string, string]> = {
  text: ["Texte", "Text"],
  number: ["Nombre", "Number"],
  boolean: ["Case à cocher", "Checkbox"],
  date: ["Date", "Date"],
  datetime: ["Date et heure", "Date and time"],
  select: ["Liste déroulante", "Drop-down list"],
  multiselect: ["Choix multiples", "Multiple choice"],
  email: ["Email", "Email"],
  phone: ["Téléphone", "Phone"],
  url: ["URL", "URL"],
};

const CUSTOM_FIELD_TYPES_WITH_OPTIONS = new Set<CreateCustomFieldInput["type"]>([
  "select",
  "multiselect",
]);

/**
 * Lets an org owner adapt KORVA's core entities (contacts, leads, offers, bookings, orders) to
 * their own sector — e.g. a real-estate agency adding "surface (m²)" to contacts, a workshop
 * adding "warranty months" to offers. The backend (`apps/api/src/custom-fields`) already
 * validates every write against these definitions (unknown keys rejected, required enforced,
 * type-checked) — this section is what makes that existing, previously invisible capability
 * actually usable. Create + delete only, matching RolesManagementSection's exact v1 scope above:
 * fix a mistake by deleting and recreating rather than editing in place.
 */
function CustomFieldsSection() {
  const t = useT();
  const authReady = useAuthReady();
  const queryClient = useQueryClient();
  const [entity, setEntity] = useState<CustomFieldEntity>("contacts");
  const [createOpen, setCreateOpen] = useState(false);
  const [optionsInput, setOptionsInput] = useState("");

  const { data: fields, isLoading } = useQuery({
    queryKey: ["custom-fields", entity],
    enabled: authReady,
    queryFn: () => apiClient.get<CustomField[]>(`/custom-fields?entity=${entity}`),
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<CreateCustomFieldInput>({
    resolver: zodResolver(createCustomFieldSchema),
    defaultValues: { entity, key: "", label: "", type: "text", required: false },
  });
  const selectedType = watch("type");

  const createMutation = useMutation({
    mutationFn: (input: CreateCustomFieldInput) =>
      apiClient.post<CustomField>("/custom-fields", input),
    onSuccess: () => {
      reset({ entity, key: "", label: "", type: "text", required: false });
      setOptionsInput("");
      setCreateOpen(false);
      return queryClient.invalidateQueries({ queryKey: ["custom-fields", entity] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/custom-fields/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["custom-fields", entity] }),
  });

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text">{t("Champs personnalisés", "Custom fields")}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {t(
              "Ajoutez des champs propres à votre activité sur les contacts, prospects, produits, réservations et commandes.",
              "Add fields specific to your business to contacts, leads, products, bookings and orders.",
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setCreateOpen((v) => !v)}
        >
          {createOpen ? t("Annuler", "Cancel") : t("Ajouter un champ", "Add a field")}
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {CUSTOM_FIELD_ENTITIES.map((option) => (
          <Button
            key={option}
            type="button"
            variant={entity === option ? "primary" : "ghost"}
            size="sm"
            onClick={() => setEntity(option)}
          >
            {t(...CUSTOM_FIELD_ENTITY_LABELS[option])}
          </Button>
        ))}
      </div>

      {createOpen && (
        <form
          onSubmit={handleSubmit((values) =>
            createMutation.mutate({
              ...values,
              entity,
              options: CUSTOM_FIELD_TYPES_WITH_OPTIONS.has(values.type)
                ? optionsInput
                    .split(",")
                    .map((option) => option.trim())
                    .filter(Boolean)
                : undefined,
            }),
          )}
          className="mt-4 grid grid-cols-2 gap-3 rounded-md border border-border p-4"
        >
          <div>
            <label className="mb-1 block text-xs font-medium text-text" htmlFor="custom-field-key">
              {t("Clé (identifiant technique)", "Key (technical identifier)")}
            </label>
            <Input
              id="custom-field-key"
              placeholder={t("ex. surface_m2", "e.g. surface_m2")}
              error={!!errors.key}
              {...register("key")}
            />
            {errors.key && <p className="mt-1 text-xs text-destructive">{errors.key.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text" htmlFor="custom-field-label">
              {t("Libellé affiché", "Display label")}
            </label>
            <Input
              id="custom-field-label"
              placeholder={t("ex. Surface (m²)", "e.g. Surface (m²)")}
              error={!!errors.label}
              {...register("label")}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text" htmlFor="custom-field-type">
              {t("Type", "Type")}
            </label>
            <Select id="custom-field-type" className="w-full" {...register("type")}>
              {CUSTOM_FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(...CUSTOM_FIELD_TYPE_LABELS[type])}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 self-end text-sm text-text">
            <input type="checkbox" {...register("required")} />
            {t("Obligatoire", "Required")}
          </label>
          {CUSTOM_FIELD_TYPES_WITH_OPTIONS.has(selectedType) && (
            <div className="col-span-2">
              <label
                className="mb-1 block text-xs font-medium text-text"
                htmlFor="custom-field-options"
              >
                {t("Options (séparées par des virgules)", "Options (comma-separated)")}
              </label>
              <Input
                id="custom-field-options"
                className="w-full"
                placeholder={t("ex. Petit, Moyen, Grand", "e.g. Small, Medium, Large")}
                value={optionsInput}
                onChange={(e) => setOptionsInput(e.target.value)}
              />
            </div>
          )}
          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {createMutation.error instanceof ApiError
                ? createMutation.error.message
                : t("Impossible de créer ce champ.", "This field could not be created.")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer le champ", "Create the field")}
          </Button>
        </form>
      )}

      {isLoading ? (
        <p className="mt-4 text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
      ) : fields?.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">
          {t(
            `Aucun champ personnalisé pour ${CUSTOM_FIELD_ENTITY_LABELS[entity][0].toLowerCase()}.`,
            `No custom fields for ${CUSTOM_FIELD_ENTITY_LABELS[entity][1].toLowerCase()}.`,
          )}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {fields?.map((field) => (
            <li key={field.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-text">{field.label}</span>
                <Badge>{t(...CUSTOM_FIELD_TYPE_LABELS[field.type])}</Badge>
                {field.required && <Badge>{t("Obligatoire", "Required")}</Badge>}
                <span className="text-xs text-text-muted">{field.key}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={deleteMutation.isPending && deleteMutation.variables === field.id}
                onClick={() => deleteMutation.mutate(field.id)}
              >
                {t("Supprimer", "Delete")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {deleteMutation.isError && (
        <p className="mt-2 text-sm text-destructive">
          {deleteMutation.error instanceof ApiError
            ? deleteMutation.error.message
            : t("Impossible de supprimer ce champ.", "This field could not be deleted.")}
        </p>
      )}
    </section>
  );
}

/**
 * Discoverability for the embeddable lead-capture widget (docs/BUSINESS_OS_AUDIT.md roadmap
 * item #8, apps/storefront/public/korva-widget.js) and for KORVA's own hosted storefront page
 * (item #9) — without this, both features would be invisible to the business owner despite
 * being fully functional. `NEXT_PUBLIC_STOREFRONT_URL` makes the storefront domain real (unlike
 * the prior placeholder "VOTRE-DOMAINE-STOREFRONT"), same pattern as NEXT_PUBLIC_API_URL.
 */
const WIDGET_MODE_OPTIONS: { value: string; label: [string, string]; description: [string, string] }[] = [
  {
    value: "leads",
    label: ["Capture de contacts", "Contact capture"],
    description: ["Un formulaire simple pour recevoir des demandes de contact.", "A simple form to receive contact requests."],
  },
  {
    value: "catalog",
    label: ["Boutique", "Shop"],
    description: ["Vos visiteurs parcourent votre catalogue et commandent directement.", "Your visitors browse your catalogue and order directly."],
  },
  {
    value: "booking",
    label: ["Réservation", "Booking"],
    description: ["Vos visiteurs réservent un créneau directement.", "Your visitors book a slot directly."],
  },
  {
    value: "full",
    label: ["Boutique + réservation", "Shop + booking"],
    description: ["Les deux, avec des onglets dans le widget.", "Both, with tabs in the widget."],
  },
];

/**
 * Live preview of the org's public storefront right inside Settings, so a change made just
 * above (in the Organisation form) can be checked without leaving the page or opening a new
 * tab. This embeds the REAL storefront (via iframe), not a client-side re-render of unsaved
 * form state — so it only reflects what's actually been saved; "Rafraîchir" reloads it after a
 * save. Collapsed by default (an iframe pointed at a heavy Next.js page is not free to load).
 */
function StorefrontPreviewSection({
  slug,
  previewTemplate,
  previewPalette,
  previewFontPairing,
}: {
  slug: string;
  /** Unsaved edits from the organization form — reflected in the preview immediately via query
   *  params the storefront reads client-side only for this presentational override (see
   *  apps/storefront storefront-client.tsx's usePreviewOverride). Never affects what gets saved. */
  previewTemplate?: string;
  previewPalette?: string;
  previewFontPairing?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const storefrontUrl = STOREFRONT_URL;
  const previewParams = new URLSearchParams();
  if (previewTemplate) previewParams.set("template", previewTemplate);
  if (previewPalette) previewParams.set("palette", previewPalette);
  if (previewFontPairing) previewParams.set("font", previewFontPairing);
  const query = previewParams.toString();
  const storefrontPageUrl = `${storefrontUrl}/${slug}${query ? `?${query}` : ""}`;

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">{t("Aperçu de ma page publique", "Preview of my public page")}</h2>
        <div className="flex items-center gap-2">
          {open && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              {t("Rafraîchir", "Refresh")}
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? t("Masquer", "Hide") : t("Afficher", "Show")}
          </Button>
        </div>
      </div>
      {open && (
        <iframe
          key={`${reloadKey}-${query}`}
          src={storefrontPageUrl}
          title={t("Aperçu de la page publique", "Public page preview")}
          className="mt-4 h-[600px] w-full rounded-md border border-border"
        />
      )}
    </section>
  );
}

/**
 * Storefront "content" sections (testimonials/team/gallery/about) — Pro plan and above, see
 * EntitlementsService.assertContentSectionsAllowed. Each sub-editor mutates immediately (no
 * unsaved-draft concept) via a whole-array-replace PATCH /organizations/me, matching this
 * codebase's established non-optimistic-but-immediate-action pattern for list-like settings
 * (e.g. the Categories page). Renders nothing to seed local state from until `organization` has
 * actually loaded — the inner components' `useState(organization.field ?? ...)` initializers
 * then correctly capture real data on their first (and only) mount, with no sync effect needed.
 */
function StorefrontContentSection() {
  const t = useT();
  const authReady = useAuthReady();
  const { data: organization, isLoading } = useActiveOrganization();
  const { data: subscription } = useQuery({
    queryKey: ["subscriptions", "me"],
    enabled: authReady,
    queryFn: () => apiClient.get<SubscriptionSummary>("/subscriptions/me"),
  });
  const planKey = subscription?.plan.key;
  // The site grows with the plan: the story on Starter, the showcase on Pro (PLAN_FEATURE_MIN_PLAN).
  const storyAllowed = !planKey || planHasFeature(planKey, "site_about_faq");
  const showcaseAllowed = !planKey || planHasFeature(planKey, "site_showcase");
  const trackingAllowed = !planKey || planHasFeature(planKey, "site_tracking");
  const slideshowAllowed = !planKey || planHasFeature(planKey, "hero_slideshow");

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="text-sm font-semibold text-text">{t("Contenu de la page publique", "Public page content")}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {t(
          "Plus votre formule est complète, plus votre site l'est : votre histoire dès Starter, votre équipe et vos photos dès Pro.",
          "The fuller your plan, the fuller your website: your story from Starter, your team and photos from Pro.",
        )}
      </p>
      {!isLoading && organization && (
        <div className="mt-5 space-y-6">
          <div className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text">{t("Votre histoire", "Your story")}</h3>
              {!storyAllowed && <Badge>{t("🔒 Formule Starter", "🔒 Starter plan")}</Badge>}
            </div>
            <fieldset disabled={!storyAllowed} className="mt-3 space-y-6 disabled:opacity-60">
              <AnnouncementEditor organization={organization} />
              <AboutTextEditor organization={organization} />
              <FaqEditor organization={organization} />
            </fieldset>
          </div>
          <div className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text">{t("Votre vitrine", "Your showcase")}</h3>
              {!showcaseAllowed && <Badge>{t("🔒 Formule Pro", "🔒 Pro plan")}</Badge>}
            </div>
            <fieldset disabled={!showcaseAllowed} className="mt-3 space-y-6 disabled:opacity-60">
              <TeamMembersEditor organization={organization} />
              <GalleryEditor organization={organization} />
              <TestimonialsEditor organization={organization} />
            </fieldset>
          </div>
          <div className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text">{t("Mesure d'audience et publicité", "Audience and ad tracking")}</h3>
              {!trackingAllowed && <Badge>{t("🔒 Formule Pro", "🔒 Pro plan")}</Badge>}
            </div>
            <fieldset disabled={!trackingAllowed} className="mt-3 disabled:opacity-60">
              <TrackingEditor organization={organization} />
            </fieldset>
          </div>
          <div className="rounded-md border border-border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-text">{t("Diaporama d'accueil", "Home slideshow")}</h3>
              {!slideshowAllowed && <Badge>{t("🔒 Formule Business", "🔒 Business plan")}</Badge>}
            </div>
            <fieldset disabled={!slideshowAllowed} className="mt-3 disabled:opacity-60">
              <HeroSlidesEditor organization={organization} />
            </fieldset>
          </div>
        </div>
      )}
    </section>
  );
}

/** Google Analytics / Meta Pixel ids (site_tracking, Pro and above). The site loads them only
 *  after each visitor accepts its cookie banner. "" removes an id. */
function TrackingEditor({ organization }: { organization: Organization }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [googleAnalyticsId, setGoogleAnalyticsId] = useState(organization.googleAnalyticsId ?? "");
  const [metaPixelId, setMetaPixelId] = useState(organization.metaPixelId ?? "");
  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch<Organization>("/organizations/me", {
        googleAnalyticsId: googleAnalyticsId.trim(),
        metaPixelId: metaPixelId.trim(),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">
        {t(
          "Mesurez vos visites et vos publicités. Vos visiteurs voient d'abord un bandeau : rien n'est chargé sans leur accord.",
          "Measure your visits and your ads. Visitors first see a banner: nothing loads without their consent.",
        )}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ga-id" className="mb-1 block text-xs font-medium text-text">
            {t("Identifiant Google Analytics", "Google Analytics ID")}
          </label>
          <Input id="ga-id" placeholder="G-XXXXXXXXXX" value={googleAnalyticsId} onChange={(e) => setGoogleAnalyticsId(e.target.value)} />
        </div>
        <div>
          <label htmlFor="meta-pixel-id" className="mb-1 block text-xs font-medium text-text">
            {t("Identifiant Meta Pixel (Facebook, Instagram)", "Meta Pixel ID (Facebook, Instagram)")}
          </label>
          <Input id="meta-pixel-id" inputMode="numeric" placeholder="123456789012345" value={metaPixelId} onChange={(e) => setMetaPixelId(e.target.value)} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          {t("Enregistrer le suivi", "Save tracking")}
        </Button>
        {mutation.isSuccess && <p className="text-xs text-text-muted">{t("Enregistré.", "Saved.")}</p>}
        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : t("Erreur", "Error")}
          </p>
        )}
      </div>
    </div>
  );
}

/** Photos after the main one in the home slideshow (hero_slideshow, Business). */
function HeroSlidesEditor({ organization }: { organization: Organization }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const slides = organization.heroSlides ?? [];
  const full = slides.length >= HERO_SLIDES_MAX;

  const mutation = useMutation({
    mutationFn: (next: string[]) => apiClient.patch<Organization>("/organizations/me", { heroSlides: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const result = await uploadFile(file);
      mutation.mutate([...slides, result.url]);
    } catch (error) {
      setUploadError(error instanceof ApiError ? error.message : t("Échec de l'envoi du fichier.", "The file could not be uploaded."));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-muted">
          {t(
            `Jusqu'à ${HERO_SLIDES_MAX} photos qui défilent après votre photo d'accueil.`,
            `Up to ${HERO_SLIDES_MAX} photos shown after your home photo.`,
          )}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => void handleUpload(event.target.files?.[0])}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={uploading}
          disabled={full}
          onClick={() => fileInputRef.current?.click()}
        >
          {t("Ajouter une photo au diaporama", "Add a slideshow photo")}
        </Button>
      </div>
      {!organization.heroImage && slides.length > 0 && (
        <p className="mt-2 text-xs text-text-muted">
          {t("Ajoutez aussi une photo d'accueil ci-dessus : elle ouvre le diaporama.", "Also add a home photo above: it opens the slideshow.")}
        </p>
      )}
      {uploadError && <p className="mt-2 text-xs text-destructive">{uploadError}</p>}
      {mutation.isError && (
        <p className="mt-2 text-xs text-destructive">
          {mutation.error instanceof ApiError ? mutation.error.message : t("Erreur", "Error")}
        </p>
      )}
      {slides.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {slides.map((url, index) => (
            <div key={url} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- uploaded URL */}
              <img src={url} alt={t(`Photo ${index + 2} du diaporama`, `Slideshow photo ${index + 2}`)} className="h-20 w-full rounded-md border border-border object-cover" />
              <button
                type="button"
                aria-label={t(`Retirer la photo ${index + 2}`, `Remove photo ${index + 2}`)}
                onClick={() => mutation.mutate(slides.filter((slide) => slide !== url))}
                className="absolute right-1 top-1 rounded bg-surface px-1.5 py-0.5 text-xs text-destructive shadow"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The one-line band at the top of the public site (site_announcement, Starter and above). */
function AnnouncementEditor({ organization }: { organization: Organization }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(organization.announcement ?? "");
  const mutation = useMutation({
    mutationFn: (announcement: string) =>
      apiClient.patch<Organization>("/organizations/me", { announcement }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });

  return (
    <div>
      <label htmlFor="site-announcement" className="mb-1 block text-xs font-medium text-text">
        {t("Bandeau d'annonce", "Announcement bar")}
      </label>
      <Input
        id="site-announcement"
        maxLength={140}
        placeholder={t("Ex. : Livraison offerte ce week-end à Cocody", "E.g. Free delivery this weekend")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <p className="mt-1 text-xs text-text-muted">
        {t(
          "Affiché tout en haut de votre site. Laissez vide pour le retirer.",
          "Shown at the very top of your website. Leave empty to remove it.",
        )}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          loading={mutation.isPending}
          onClick={() => mutation.mutate(value.trim())}
        >
          {mutation.isPending ? t("Enregistrement...", "Saving...") : t("Enregistrer l'annonce", "Save the announcement")}
        </Button>
        {mutation.isSuccess && <p className="text-xs text-text-muted">{t("Enregistré.", "Saved.")}</p>}
        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : t("Erreur", "Error")}
          </p>
        )}
      </div>
    </div>
  );
}

function AboutTextEditor({ organization }: { organization: Organization }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(organization.aboutText ?? "");
  const mutation = useMutation({
    mutationFn: (aboutText: string) =>
      apiClient.patch<Organization>("/organizations/me", { aboutText }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-text">{t("À propos", "About")}</p>
      <textarea
        className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
        rows={4}
        maxLength={4000}
        placeholder={t("Racontez l'histoire de votre entreprise...", "Tell your business's story...")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          loading={mutation.isPending}
          onClick={() => mutation.mutate(value)}
        >
          {mutation.isPending ? t("Enregistrement...", "Saving...") : t("Enregistrer le texte", "Save the text")}
        </Button>
        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : t("Erreur", "Error")}
          </p>
        )}
      </div>
    </div>
  );
}

interface TestimonialFormValues {
  authorName: string;
  role?: string;
  quote: string;
  rating?: number;
}

function TestimonialsEditor({ organization }: { organization: Organization }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const testimonials = organization.testimonials ?? [];

  const { register, handleSubmit, reset } = useForm<TestimonialFormValues>({
    defaultValues: { authorName: "", quote: "" },
  });

  const mutation = useMutation({
    mutationFn: (next: Testimonial[]) =>
      apiClient.patch<Organization>("/organizations/me", { testimonials: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations", "me"] });
      setAddOpen(false);
      reset({ authorName: "", quote: "" });
    },
  });

  function addTestimonial(values: TestimonialFormValues) {
    mutation.mutate([...testimonials, { id: crypto.randomUUID(), ...values }]);
  }
  function removeTestimonial(id: string) {
    mutation.mutate(testimonials.filter((t) => t.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text">{t("Témoignages clients", "Customer testimonials")}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          {t("Ajouter un témoignage", "Add a testimonial")}
        </Button>
      </div>
      {testimonials.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">{t("Aucun témoignage.", "No testimonials.")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {testimonials.map((testimonial) => (
            <li
              key={testimonial.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm"
            >
              <div>
                <p className="font-medium text-text">
                  {testimonial.authorName}
                  {testimonial.role ? ` — ${testimonial.role}` : ""}
                </p>
                <p className="mt-0.5 text-text-muted">{testimonial.quote}</p>
              </div>
              <button
                type="button"
                onClick={() => removeTestimonial(testimonial.id)}
                className="shrink-0 text-xs text-destructive hover:underline"
              >
                {t("Supprimer", "Delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title={t("Ajouter un témoignage", "Add a testimonial")}>
        <form onSubmit={handleSubmit(addTestimonial)} className="space-y-3">
          <Input placeholder={t("Nom du client", "Customer name")} {...register("authorName", { required: true })} />
          <Input placeholder={t(
            "Rôle / entreprise (optionnel)",
            "Role / company (optional)",
          )} {...register("role")} />
          <textarea
            placeholder={t("Témoignage", "Testimonial")}
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={3}
            {...register("quote", { required: true })}
          />
          <Input
            type="number"
            min={1}
            max={5}
            placeholder={t("Note sur 5 (optionnel)", "Rating out of 5 (optional)")}
            {...register("rating", {
              setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
            })}
          />
          {mutation.isError && (
            <p className="text-xs text-destructive">
              {mutation.error instanceof ApiError ? mutation.error.message : t("Erreur", "Error")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              {t("Annuler", "Cancel")}
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t("Ajout...", "Adding...") : t("Ajouter", "Add")}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

interface TeamMemberFormValues {
  name: string;
  role: string;
  bio?: string;
}

function TeamMembersEditor({ organization }: { organization: Organization }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(undefined);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const teamMembers = organization.teamMembers ?? [];

  const { register, handleSubmit, reset } = useForm<TeamMemberFormValues>({
    defaultValues: { name: "", role: "" },
  });

  const mutation = useMutation({
    mutationFn: (next: TeamMember[]) =>
      apiClient.patch<Organization>("/organizations/me", { teamMembers: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations", "me"] });
      setAddOpen(false);
      setPhotoUrl(undefined);
      reset({ name: "", role: "" });
    },
  });

  async function handlePhotoUpload(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setPhotoUploading(true);
    try {
      const result = await uploadFile(file);
      setPhotoUrl(result.url);
    } catch (error) {
      setUploadError(error instanceof ApiError ? error.message : t(
        "Échec de l'envoi du fichier.",
        "The file could not be uploaded.",
      ));
    } finally {
      setPhotoUploading(false);
    }
  }

  function addTeamMember(values: TeamMemberFormValues) {
    mutation.mutate([
      ...teamMembers,
      { id: crypto.randomUUID(), photo: photoUrl, ...values },
    ]);
  }
  function removeTeamMember(id: string) {
    mutation.mutate(teamMembers.filter((m) => m.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text">{t("Équipe", "Team")}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          {t("Ajouter un membre", "Add a member")}
        </Button>
      </div>
      {teamMembers.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">{t("Aucun membre.", "No members.")}</p>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {teamMembers.map((member) => (
            <li
              key={member.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm"
            >
              <div>
                <p className="font-medium text-text">{member.name}</p>
                <p className="text-xs text-text-muted">{member.role}</p>
              </div>
              <button
                type="button"
                onClick={() => removeTeamMember(member.id)}
                className="shrink-0 text-xs text-destructive hover:underline"
              >
                {t("Supprimer", "Delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={t("Ajouter un membre de l'équipe", "Add a team member")}
      >
        <form onSubmit={handleSubmit(addTeamMember)} className="space-y-3">
          <Input placeholder={t("Nom", "Name")} {...register("name", { required: true })} />
          <Input placeholder={t("Rôle", "Role")} {...register("role", { required: true })} />
          <textarea
            placeholder={t("Bio (optionnel)", "Bio (optional)")}
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={2}
            {...register("bio")}
          />
          <div className="flex items-center gap-2">
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => void handlePhotoUpload(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={photoUploading}
              onClick={() => photoInputRef.current?.click()}
            >
              {photoUrl ? t("Changer la photo", "Change the photo") : t("Ajouter une photo", "Add a photo")}
            </Button>
            {photoUrl && <span className="text-xs text-text-muted">{t("Photo ajoutée", "Photo added")}</span>}
          </div>
          {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
          {mutation.isError && (
            <p className="text-xs text-destructive">
              {mutation.error instanceof ApiError ? mutation.error.message : t("Erreur", "Error")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              {t("Annuler", "Cancel")}
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t("Ajout...", "Adding...") : t("Ajouter", "Add")}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function GalleryEditor({ organization }: { organization: Organization }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryImages = organization.galleryImages ?? [];

  const mutation = useMutation({
    mutationFn: (next: GalleryImage[]) =>
      apiClient.patch<Organization>("/organizations/me", { galleryImages: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const result = await uploadFile(file);
      mutation.mutate([...galleryImages, { id: crypto.randomUUID(), url: result.url }]);
    } catch (error) {
      setUploadError(error instanceof ApiError ? error.message : t(
        "Échec de l'envoi du fichier.",
        "The file could not be uploaded.",
      ));
    } finally {
      setUploading(false);
    }
  }
  function removeImage(id: string) {
    mutation.mutate(galleryImages.filter((image) => image.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text">{t("Galerie photo", "Photo gallery")}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => void handleUpload(event.target.files?.[0])}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {t("Ajouter une image", "Add an image")}
        </Button>
      </div>
      {uploadError && <p className="mt-2 text-xs text-destructive">{uploadError}</p>}
      {mutation.isError && (
        <p className="mt-2 text-xs text-destructive">
          {mutation.error instanceof ApiError ? mutation.error.message : t("Erreur", "Error")}
        </p>
      )}
      {galleryImages.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">{t("Aucune image.", "No images.")}</p>
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {galleryImages.map((image) => (
            <div key={image.id} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.caption ?? ""}
                className="h-20 w-full rounded-md border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(image.id)}
                className="absolute right-1 top-1 rounded bg-surface px-1.5 py-0.5 text-xs text-destructive shadow"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface FaqItemFormValues {
  question: string;
  answer: string;
}

function FaqEditor({ organization }: { organization: Organization }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const faqItems = organization.faqItems ?? [];

  const { register, handleSubmit, reset } = useForm<FaqItemFormValues>({
    defaultValues: { question: "", answer: "" },
  });

  const mutation = useMutation({
    mutationFn: (next: FaqItem[]) =>
      apiClient.patch<Organization>("/organizations/me", { faqItems: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations", "me"] });
      setAddOpen(false);
      reset({ question: "", answer: "" });
    },
  });

  function addFaqItem(values: FaqItemFormValues) {
    mutation.mutate([...faqItems, { id: crypto.randomUUID(), ...values }]);
  }
  function removeFaqItem(id: string) {
    mutation.mutate(faqItems.filter((item) => item.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text">{t("Questions fréquentes", "Frequently asked questions")}</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          {t("Ajouter une question", "Add a question")}
        </Button>
      </div>
      {faqItems.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">{t("Aucune question.", "No questions.")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {faqItems.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm"
            >
              <div>
                <p className="font-medium text-text">{item.question}</p>
                <p className="mt-0.5 text-text-muted">{item.answer}</p>
              </div>
              <button
                type="button"
                onClick={() => removeFaqItem(item.id)}
                className="shrink-0 text-xs text-destructive hover:underline"
              >
                {t("Supprimer", "Delete")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title={t("Ajouter une question", "Add a question")}>
        <form onSubmit={handleSubmit(addFaqItem)} className="space-y-3">
          <Input placeholder={t("Question", "Question")} {...register("question", { required: true })} />
          <textarea
            placeholder={t("Réponse", "Answer")}
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={3}
            {...register("answer", { required: true })}
          />
          {mutation.isError && (
            <p className="text-xs text-destructive">
              {mutation.error instanceof ApiError ? mutation.error.message : t("Erreur", "Error")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              {t("Annuler", "Cancel")}
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? t("Ajout...", "Adding...") : t("Ajouter", "Add")}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function StorefrontThemePicker({
  planKey,
  selectedTemplate,
  selectedPalette,
  selectedFontPairing,
  onChangeTemplate,
  onChangePalette,
  onChangeFontPairing,
}: {
  planKey?: string;
  selectedTemplate?: StorefrontTemplateKey;
  selectedPalette?: StorefrontPaletteKey;
  selectedFontPairing?: StorefrontFontPairingKey;
  onChangeTemplate: (key: StorefrontTemplateKey) => void;
  onChangePalette: (key: StorefrontPaletteKey) => void;
  onChangeFontPairing: (key: StorefrontFontPairingKey) => void;
}) {
  const t = useT();
  const effectiveTemplateKey = selectedTemplate ?? "essentiel";
  const currentTemplate =
    STOREFRONT_TEMPLATES.find((t) => t.key === effectiveTemplateKey) ?? STOREFRONT_TEMPLATES[0];
  const canRefine = !planKey || planMeetsMinimum(planKey, currentTemplate.refinedChoiceMinPlan);
  const canPremium = !planKey || planMeetsMinimum(planKey, PREMIUM_THEME_MIN_PLAN);
  // The template's own choices, then the premium ones every sector template offers on Pro.
  const paletteChoices = [
    ...currentTemplate.palettes.map((key, index) => ({ key, premium: false, allowed: index === 0 || canRefine })),
    ...PREMIUM_PALETTE_KEYS.map((key) => ({ key, premium: true, allowed: canPremium })),
  ];
  const fontChoices = [
    ...currentTemplate.fontPairings.map((key, index) => ({ key, premium: false, allowed: index === 0 || canRefine })),
    ...PREMIUM_FONT_PAIRING_KEYS.map((key) => ({ key, premium: true, allowed: canPremium })),
  ];

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-text">{t("Gabarit de la page publique", "Public page template")}</p>
      <p className="mb-2 text-xs text-text-muted">
        {t(
          "Chaque gabarit propose une mise en page différente, pensée pour un secteur d'activité.",
          "Each template offers a different layout, designed for a line of business.",
        )}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {STOREFRONT_TEMPLATES.map((template) => {
          const isAllowed = !planKey || planMeetsMinimum(planKey, template.minPlan);
          const isSelected = effectiveTemplateKey === template.key;
          return (
            <button
              key={template.key}
              type="button"
              disabled={!isAllowed}
              onClick={() => onChangeTemplate(template.key)}
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                isSelected ? "border-text" : "border-border"
              } ${!isAllowed ? "opacity-60" : ""}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium text-text">{template.label}</span>
                {!isAllowed && <Badge>{t("Non inclus dans le plan", "Not included in the plan")}</Badge>}
              </span>
              <span className="mt-0.5 block text-xs text-text-muted">{template.description}</span>
            </button>
          );
        })}
      </div>

      {currentTemplate.palettes.length > 0 && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-text">{t("Palette de couleurs", "Colour palette")}</p>
            <div className="flex flex-wrap gap-2">
              {paletteChoices.map(({ key: paletteKey, premium, allowed: isAllowed }) => {
                const palette = STOREFRONT_PALETTES[paletteKey];
                const isSelected = (selectedPalette ?? currentTemplate.palettes[0]) === paletteKey;
                return (
                  <button
                    key={paletteKey}
                    type="button"
                    disabled={!isAllowed}
                    onClick={() => onChangePalette(paletteKey)}
                    title={isAllowed ? palette.label : t(`${palette.label} — nécessite un plan supérieur`, `${palette.label} — needs a higher plan`)}
                    className={`flex items-center gap-2 rounded-full border px-2 py-1 text-xs ${
                      isSelected ? "border-text" : "border-border"
                    } ${!isAllowed ? "opacity-50" : ""}`}
                  >
                    <span
                      className="h-4 w-4 rounded-full border border-border-input"
                      style={{ backgroundColor: palette.accent }}
                    />
                    {palette.label}
                    {premium && <span className="font-semibold text-action">{t("Premium", "Premium")}</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-text">{t("Police", "Font")}</p>
            <div className="flex flex-wrap gap-2">
              {fontChoices.map(({ key: fontKey, premium, allowed: isAllowed }) => {
                const font = STOREFRONT_FONT_PAIRINGS[fontKey];
                const isSelected = (selectedFontPairing ?? currentTemplate.fontPairings[0]) === fontKey;
                return (
                  <button
                    key={fontKey}
                    type="button"
                    disabled={!isAllowed}
                    onClick={() => onChangeFontPairing(fontKey)}
                    className={`rounded-full border px-3 py-1 text-xs ${
                      isSelected ? "border-text" : "border-border"
                    } ${!isAllowed ? "opacity-50" : ""}`}
                  >
                    {font.label}
                    {premium && <span className="ml-1 font-semibold text-action">{t("Premium", "Premium")}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ExternalWebsiteSection({ slug }: { slug: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState("leads");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const storefrontUrl = STOREFRONT_URL;
  const storefrontPageUrl = `${storefrontUrl}/${slug}`;
  // The default "leads" snippet is byte-identical to the one this section rendered before the
  // mode picker existed (no data-mode attribute at all) — an existing embed on a business's own
  // site keeps working unchanged, and re-copying the same default snippet is a no-op for them.
  const snippet = `<script
  src="${storefrontUrl}/korva-widget.js"
  data-org="${slug}"
  data-api-url="${apiUrl}"${mode !== "leads" ? `\n  data-mode="${mode}"` : ""}
  async
></script>`;
  const selectedOption = WIDGET_MODE_OPTIONS.find((option) => option.value === mode);

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">{t("Mon site existant", "My existing website")}</h2>
        <a
          href={storefrontPageUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-text underline-offset-2 hover:underline"
        >
          {t("Voir ma page publique", "See my public page")} →
        </a>
      </div>
      <p className="mt-1 text-sm text-text-muted">
        {t(
          "Ajoutez ce widget sur votre site web actuel pour interagir avec vos visiteurs directement depuis KORVA.",
          "Add this widget to your current website to interact with your visitors straight from KORVA.",
        )}
      </p>

      <label className="mt-4 block text-sm">
        <span className="mb-1 block text-text-muted">{t(
          "Ce que le widget doit faire",
          "What the widget should do",
        )}</span>
        <Select value={mode} onChange={(event) => setMode(event.target.value)} className="w-full sm:w-72">
          {WIDGET_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(...option.label)}
            </option>
          ))}
        </Select>
        {selectedOption && (
          <span className="mt-1 block text-xs text-text-muted">{t(...selectedOption.description)}</span>
        )}
      </label>

      <pre className="mt-4 overflow-x-auto rounded-md bg-surface-muted p-3 text-xs">
        <code>{snippet}</code>
      </pre>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() => {
          void navigator.clipboard.writeText(snippet);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? t("Copié !", "Copied!") : t("Copier le code", "Copy the code")}
      </Button>
    </section>
  );
}

const WEBHOOK_EVENT_LABELS: Record<string, [string, string]> = {
  "lead.created": ["Prospect créé", "Lead created"],
  "quote.created": ["Devis créé", "Quote created"],
  "quote.accepted": ["Devis accepté", "Quote accepted"],
  "quote.expired": ["Devis expiré", "Quote expired"],
  "order.created": ["Commande créée", "Order created"],
  "payment.completed": ["Paiement complété", "Payment completed"],
  "booking.created": ["Réservation créée", "Booking created"],
  "booking.cancelled": ["Réservation annulée", "Booking cancelled"],
  "customer.created": ["Client créé", "Customer created"],
  "invoice.overdue": ["Facture en retard", "Invoice overdue"],
  "customer.inactive": ["Client inactif", "Customer inactive"],
  "payment.webhook_received": ["Webhook paiement reçu", "Payment webhook received"],
  "whatsapp.status_updated": ["Statut WhatsApp mis à jour", "WhatsApp status updated"],
  "offer.created": ["Offre créée", "Offer created"],
  "message.sent": ["Message envoyé", "Message sent"],
  "subscription.plan_changed": ["Plan d'abonnement changé", "Subscription plan changed"],
  "expense.created": ["Dépense créée", "Expense created"],
  "recurring_billing.created": ["Abonnement client créé", "Customer subscription created"],
  "recurring_billing.charged": ["Abonnement client facturé", "Customer subscription charged"],
  "recurring_billing.cancelled": ["Abonnement client résilié", "Customer subscription cancelled"],
  "return_request.created": ["Demande de retour créée", "Return request created"],
  "return_request.approved": ["Retour approuvé (remboursé)", "Return approved (refunded)"],
  "return_request.rejected": ["Retour refusé", "Return rejected"],
};

/**
 * A first-class outbound-webhook subscription system for external partners — signed deliveries
 * (HMAC), retry/backoff, and a per-subscription delivery log, distinct from the Workflow
 * Engine's own `webhook` action (see docs/BUSINESS_OS_AUDIT.md §6). The secret is shown exactly
 * once (at creation and at each rotation), same posture as any bearer credential in this product.
 */
function WebhookSubscriptionsSection() {
  const t = useT();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const [revealedSecret, setRevealedSecret] = useState<{ id: string; secret: string } | null>(
    null,
  );
  const [copied, setCopied] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: subscriptions, isLoading } = useQuery({
    queryKey: ["webhook-subscriptions"],
    queryFn: () => apiClient.get<WebhookSubscription[]>("/webhook-subscriptions"),
    enabled: authReady,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateWebhookSubscriptionInput>({
    resolver: zodResolver(createWebhookSubscriptionSchema),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["webhook-subscriptions"] });

  const createMutation = useMutation({
    mutationFn: (input: CreateWebhookSubscriptionInput) =>
      apiClient.post<WebhookSubscriptionWithSecret>("/webhook-subscriptions", input),
    onSuccess: (created) => {
      setRevealedSecret({ id: created.id, secret: created.secret });
      reset();
      return invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.delete<{ deleted: boolean }>(`/webhook-subscriptions/${id}`),
    onSuccess: invalidate,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiClient.patch<WebhookSubscription>(`/webhook-subscriptions/${id}`, { active }),
    onSuccess: invalidate,
  });

  const rotateMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<WebhookSubscriptionWithSecret>(`/webhook-subscriptions/${id}/rotate-secret`),
    onSuccess: (rotated) => setRevealedSecret({ id: rotated.id, secret: rotated.secret }),
  });

  const deliveriesQuery = useQuery({
    queryKey: ["webhook-subscriptions", expandedId, "deliveries"],
    queryFn: () =>
      apiClient.get<WebhookDelivery[]>(`/webhook-subscriptions/${expandedId}/deliveries`),
    enabled: authReady && !!expandedId,
  });

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="text-sm font-semibold text-text">{t("Webhooks sortants", "Outgoing webhooks")}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {t(
          "Envoyez automatiquement les événements KORVA (signés, avec nouvelles tentatives) vers un logiciel partenaire.",
          "Automatically send KORVA events (signed, with retries) to partner software.",
        )}
      </p>

      {revealedSecret && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            {t(
              "Clé secrète générée — notez-la maintenant, elle ne sera plus jamais affichée.",
              "Secret key generated — write it down now, it will never be shown again.",
            )}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-white px-2 py-1 text-xs text-amber-950">
              {revealedSecret.secret}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(revealedSecret.secret);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? t("Copié !", "Copied!") : t("Copier", "Copy")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRevealedSecret(null)}>
              {t("Fermer", "Close")}
            </Button>
          </div>
        </div>
      )}

      <form
        onSubmit={handleSubmit((values) => createMutation.mutate(values))}
        className="mt-4 space-y-3 rounded-md border border-border p-4"
      >
        <div>
          <Input
            placeholder="https://partenaire.example.com/webhooks/korva"
            className="w-full"
            error={!!errors.url}
            {...register("url")}
          />
          {errors.url && <p className="mt-1 text-xs text-destructive">{errors.url.message}</p>}
        </div>
        <Input placeholder={t("Description (optionnel)", "Description (optional)")} className="w-full" {...register("description")} />
        <div>
          <p className="mb-1 text-xs font-medium text-text">{t("Événements", "Events")}</p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {SYSTEM_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" value={event} {...register("events")} />
                {(WEBHOOK_EVENT_LABELS[event] ? t(...WEBHOOK_EVENT_LABELS[event]!) : event)}
              </label>
            ))}
          </div>
          {errors.events && (
            <p className="mt-1 text-xs text-destructive">{t(
              "Sélectionnez au moins un événement.",
              "Select at least one event.",
            )}</p>
          )}
        </div>
        {createMutation.isError && (
          <p className="text-sm text-destructive">
            {createMutation.error instanceof ApiError
              ? createMutation.error.message
              : t("Impossible de créer ce webhook.", "This webhook could not be created.")}
          </p>
        )}
        <Button type="submit" loading={createMutation.isPending}>
          {createMutation.isPending ? t("Création...", "Creating...") : t("Ajouter un webhook", "Add a webhook")}
        </Button>
      </form>

      <div className="mt-4 space-y-2">
        {isLoading && <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>}
        {!isLoading && subscriptions?.length === 0 && (
          <p className="text-sm text-text-muted">{t(
            "Aucun webhook sortant configuré.",
            "No outgoing webhooks set up.",
          )}</p>
        )}
        {subscriptions?.map((subscription) => (
          <div key={subscription.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-text">{subscription.url}</p>
                {subscription.description && (
                  <p className="text-xs text-text-muted">{subscription.description}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-1">
                  {subscription.events.map((event) => (
                    <Badge key={event}>{(WEBHOOK_EVENT_LABELS[event] ? t(...WEBHOOK_EVENT_LABELS[event]!) : event)}</Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={subscription.active ? "success" : "default"}>
                  {subscription.active ? t("Actif", "Active") : t("Inactif", "Inactive")}
                </Badge>
                {subscription.lastDeliveryStatus && (
                  <Badge variant={subscription.lastDeliveryStatus === "success" ? "success" : "destructive"}>
                    {t("Dernière livraison :", "Last delivery:")}{" "}
                    {subscription.lastDeliveryStatus === "success" ? "OK" : t("échec", "failed")}
                  </Badge>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() =>
                  toggleActiveMutation.mutate({ id: subscription.id, active: !subscription.active })
                }
                loading={toggleActiveMutation.isPending && toggleActiveMutation.variables?.id === subscription.id}
              >
                {subscription.active ? t("Désactiver", "Turn off") : t("Activer", "Turn on")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => rotateMutation.mutate(subscription.id)}
                loading={rotateMutation.isPending && rotateMutation.variables === subscription.id}
              >
                {t("Régénérer la clé", "Regenerate the key")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setExpandedId(expandedId === subscription.id ? null : subscription.id)}
              >
                {expandedId === subscription.id ? t("Masquer les livraisons", "Hide deliveries") : t("Voir les livraisons", "See deliveries")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => deleteMutation.mutate(subscription.id)}
                loading={deleteMutation.isPending && deleteMutation.variables === subscription.id}
              >
                {t("Supprimer", "Delete")}
              </Button>
            </div>

            {expandedId === subscription.id && (
              <div className="mt-3 border-t border-border pt-3">
                {deliveriesQuery.isLoading && (
                  <p className="text-xs text-text-muted">{t("Chargement des livraisons...", "Loading deliveries...")}</p>
                )}
                {deliveriesQuery.data?.length === 0 && (
                  <p className="text-xs text-text-muted">{t("Aucune livraison pour le moment.", "No deliveries yet.")}</p>
                )}
                {deliveriesQuery.data && deliveriesQuery.data.length > 0 && (
                  <ul className="space-y-1">
                    {deliveriesQuery.data.map((delivery) => (
                      <li key={delivery.id} className="flex items-center justify-between text-xs">
                        <span className="text-text-muted">
                          {(WEBHOOK_EVENT_LABELS[delivery.eventName] ? t(...WEBHOOK_EVENT_LABELS[delivery.eventName]!) : delivery.eventName)}
                        </span>
                        <span className="flex items-center gap-2">
                          {delivery.responseStatus && <span className="text-text-muted">HTTP {delivery.responseStatus}</span>}
                          <span className="text-text-muted">{delivery.attempts} tentative(s)</span>
                          <Badge variant={delivery.status === "success" ? "success" : delivery.status === "failed" ? "destructive" : "default"}>
                            {delivery.status}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const AUDIT_ACTION_LABELS: Record<string, [string, string]> = {
  CREATE: ["Création", "Created"],
  UPDATE: ["Modification", "Updated"],
  DELETE: ["Suppression", "Deleted"],
  LOGIN: ["Connexion", "Sign-in"],
  LOGOUT: ["Déconnexion", "Sign-out"],
  PAYMENT: ["Paiement", "Payment"],
  REFUND: ["Remboursement", "Refund"],
  BOOKING: ["Réservation", "Booking"],
  AI_ACTION: ["Action IA", "AI action"],
  ROLE_CHANGE: ["Changement de rôle", "Role change"],
  SETTINGS_CHANGE: ["Changement de paramètres", "Settings change"],
};

/** First read UI for AuditService.record — see apps/api/src/audit/audit.controller.ts. */
function AuditLogSection() {
  const locale = useDashboardLocale();
  const t = useT();
  const authReady = useAuthReady();
  const [page, setPage] = useState(1);
  const limit = 20;
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page],
    enabled: authReady,
    queryFn: () => apiClient.getList<AuditLogEntry>(`/audit-logs?page=${page}&limit=${limit}`),
  });

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="text-sm font-semibold text-text">{t("Journal d'audit", "Audit log")}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {t(
          "Historique des actions effectuées sur votre organisation (créations, modifications, paiements...).",
          "History of the actions taken on your organization (creations, changes, payments...).",
        )}
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
      ) : !data || data.data.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">{t("Aucune entrée pour le moment.", "No entries yet.")}</p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-border">
            {data.data.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge>{(AUDIT_ACTION_LABELS[entry.action] ? t(...AUDIT_ACTION_LABELS[entry.action]!) : entry.action)}</Badge>
                  <span className="text-text">{entry.entity}</span>
                  {entry.entityId && (
                    <span className="text-xs text-text-muted">#{entry.entityId.slice(-6)}</span>
                  )}
                </div>
                <span className="text-xs text-text-muted">
                  {new Date(entry.createdAt).toLocaleString(intlLocale(locale))}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              {t("Précédent", "Previous")}
            </Button>
            <span className="text-xs text-text-muted">
              Page {data.pagination.page} / {data.pagination.totalPages}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("Suivant", "Next")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
