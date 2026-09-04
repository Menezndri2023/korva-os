"use client";

import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CORE_PERMISSIONS,
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  KORVA_MODULES,
  STOREFRONT_SECTIONS,
  STOREFRONT_TEMPLATES,
  STOREFRONT_PALETTES,
  STOREFRONT_FONT_PAIRINGS,
  SYSTEM_EVENTS,
  planMeetsMinimum,
  type StorefrontFontPairingKey,
  type StorefrontPaletteKey,
  type StorefrontTemplateKey,
} from "@korva/types";
import type {
  AiUsageSummary,
  AuditLogEntry,
  ConnectMessagingAccountInput,
  ConnectPaymentPayoutInput,
  CustomField,
  CustomFieldEntity,
  GalleryImage,
  IntegrationAccountStatus,
  IntegrationDomain,
  IntegrationSummary,
  KorvaModule,
  Organization,
  Plan,
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
import { Badge, Button, Dialog, Input, Select } from "@korva/ui";
import type { BadgeVariant } from "@korva/ui";
import { apiClient, ApiError, uploadFile } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useAuthStore } from "@/lib/auth-store";
import { useAuthReady } from "@/lib/use-auth-ready";

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

const METRIC_LABELS: Record<string, string> = {
  seats: "Membres de l'équipe",
  ai_messages_per_month: "Messages IA / mois",
};

const MODULE_LABELS: Record<KorvaModule, string> = {
  crm: "Clients & Prospects (CRM)",
  catalog: "Produits & Services",
  booking: "Réservations",
  commerce: "Commandes & E-commerce",
  finance: "Devis & Factures",
  workflow: "Automatisations",
  communication: "Communication",
  analytics: "Statistiques",
  ai: "Assistant IA",
};

// Same list as apps/web/src/app/onboarding/page.tsx — kept local rather than shared, matching
// that page's own precedent, since neither list is large enough yet to be worth extracting.
const COUNTRIES = [
  { code: "FR", label: "France" },
  { code: "CI", label: "Côte d'Ivoire" },
  { code: "SN", label: "Sénégal" },
  { code: "MA", label: "Maroc" },
  { code: "BE", label: "Belgique" },
  { code: "CA", label: "Canada" },
];
const CURRENCIES = ["EUR", "XOF", "MAD", "USD", "CAD"];
const TIMEZONES = Intl.supportedValuesOf("timeZone");

// Wave 4 Stage 2 — one card per known integration TYPE, not per row returned by the API: the
// backend controller (built in a separate isolated worktree against the same
// packages/types/src/integrations.ts contract) always returns at most one IntegrationSummary
// per domain per tenant today, so a fixed slot per domain is what lets "not yet connected"
// render as a real card (with its own Connecter action) instead of disappearing entirely.
const INTEGRATION_SLOTS: Array<{
  domain: IntegrationDomain;
  title: string;
  description: string;
  // Both domains reuse IntegrationSummary.market as the one connected-state descriptor the
  // contract exposes — it has no separate WABA-display-name field (deliberately secret-free,
  // see integrations.ts's doc comment) — so this only changes the *label* shown above it, not
  // which field is read.
  connectedLabel: string;
}> = [
  {
    // Not yet connected: no provider name here — which PSP ends up handling this organization's
    // payments is resolved server-side by market (see PaymentProviderResolverService), never
    // chosen by the tenant, so naming one specific provider before a real connection exists would
    // just be a guess. Once connected, the card below names the ACTUAL resolved provider via
    // PAYMENT_PROVIDER_DISPLAY_NAMES — this static copy is only ever shown pre-connection.
    domain: "payment",
    title: "Paiements",
    description: "Recevez vos règlements en ligne.",
    connectedLabel: "Marché",
  },
  {
    domain: "messaging",
    title: "WhatsApp Business — 360dialog",
    description: "Envoyez et recevez des messages WhatsApp avec vos clients.",
    connectedLabel: "Compte connecté",
  },
];

/** Only `flutterwave`/`paystack` have real adapters (docs/BUSINESS_OS_AUDIT.md §6) — an unknown
 *  future provider key just falls back to itself, capitalized, rather than a hardcoded name. */
const PAYMENT_PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  flutterwave: "Flutterwave",
  paystack: "Paystack",
  manual: "Manuel",
};

function paymentProviderDisplayName(provider: string): string {
  return (
    PAYMENT_PROVIDER_DISPLAY_NAMES[provider] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

const INTEGRATION_STATUS_BADGE: Record<
  IntegrationAccountStatus,
  { variant: BadgeVariant; label: string }
> = {
  pending: { variant: "warning", label: "En attente" },
  active: { variant: "success", label: "Actif" },
  disabled: { variant: "default", label: "Désactivé" },
  revoked: { variant: "destructive", label: "Révoqué" },
  error: { variant: "destructive", label: "Erreur" },
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
  const queryClient = useQueryClient();
  const { data: organization } = useActiveOrganization();
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
  const { data: plans } = useQuery({
    queryKey: ["plans"],
    queryFn: () => apiClient.get<Plan[]>("/plans"),
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
    enabled: authReady,
  });
  const aiUsagePermissionDenied =
    aiUsageError instanceof ApiError && aiUsageError.code === "PERMISSION_DENIED";

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

  const changePlanMutation = useMutation({
    mutationFn: (planKey: string) =>
      apiClient.post("/subscriptions/change-plan", { planKey }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["subscriptions", "me"] }),
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
      setUploadError(error instanceof ApiError ? error.message : "Échec de l'envoi du fichier.");
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
      country: organization.country,
      currency: organization.currency,
      timezone: organization.timezone,
      language: organization.language,
      logo: organization.logo,
      brandColor: organization.brandColor,
      tagline: organization.tagline,
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
  // templates: "Déconnecter" turns into an inline "Confirmer ?" / "Annuler" pair rather than a
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
        <h1 className="text-2xl font-semibold">Paramètres</h1>
        <p className="mt-1 text-sm text-text-muted">Informations de votre organisation.</p>
      </div>

      {/* Not migrated to <Card>: Card always renders a <div>, and these are real document
          <section>s — same exclusion as the raw <form> wrappers elsewhere (dashboard/crm,
          dashboard/bookings). */}
      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Organisation</h2>
          {organization && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => (orgEditOpen ? cancelOrgEdit() : startOrgEdit())}
            >
              {orgEditOpen ? "Annuler" : "Modifier"}
            </Button>
          )}
        </div>

        {!orgEditOpen ? (
          <dl className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-text-muted">Nom</dt>
              <dd className="mt-0.5">{organization?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Raison sociale</dt>
              <dd className="mt-0.5">{organization?.legalName ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Secteur</dt>
              <dd className="mt-0.5">{organization?.type ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Pays</dt>
              <dd className="mt-0.5">{organization?.country ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Devise</dt>
              <dd className="mt-0.5">{organization?.currency ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Fuseau horaire</dt>
              <dd className="mt-0.5">{organization?.timezone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Langue</dt>
              <dd className="mt-0.5">{organization?.language ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Couleur de marque</dt>
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
              <dt className="text-text-muted">Slogan (page publique)</dt>
              <dd className="mt-0.5">{organization?.tagline ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Image de bannière (page publique)</dt>
              <dd className="mt-0.5 truncate">{organization?.heroImage ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Frais de livraison (boutique en ligne)</dt>
              <dd className="mt-0.5">
                {organization?.shippingFlatRate != null
                  ? `${organization.shippingFlatRate} ${organization.currency}`
                  : "Gratuit"}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Sections visibles (page publique)</dt>
              <dd className="mt-0.5">
                {organization?.storefrontSections
                  ? organization.storefrontSections
                      .map((s) => (s === "catalog" ? "Catalogue" : "Réservations"))
                      .join(", ") || "Aucune"
                  : "Toutes"}
              </dd>
            </div>
            {organization?.enabledModules.includes("commerce") && (
              <div>
                <dt className="text-text-muted">Moyens de paiement acceptés</dt>
                <dd className="mt-0.5">
                  {(organization.acceptedPaymentMethods ?? ["cash"])
                    .map((m) => (m === "cash" ? "Espèces / à la livraison" : "En ligne"))
                    .join(", ")}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <form
            onSubmit={handleOrgSubmit((values) => updateOrgMutation.mutate(values))}
            className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-2"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-name">
                Nom
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
                Raison sociale
              </label>
              <Input id="org-legal-name" className="w-full" {...registerOrg("legalName")} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-type">
                Secteur d&apos;activité
              </label>
              <Input
                id="org-type"
                className="w-full"
                placeholder="ex: commerce, service, réservation..."
                error={!!orgErrors.type}
                {...registerOrg("type")}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-country">
                Pays
              </label>
              <Select id="org-country" className="w-full" {...registerOrg("country")}>
                {COUNTRIES.map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-currency">
                Devise
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
                Fuseau horaire
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
                Langue
              </label>
              <Input id="org-language" className="w-full" {...registerOrg("language")} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-brand-color">
                Couleur de marque
              </label>
              {/* setValueAs: brandColor/logo are optional but format-constrained (hex/url) —
                  an uncontrolled input left untouched by the user always submits "" (never
                  `undefined`, regardless of what reset() set as the default), which fails the
                  regex/.url() check even though the field is meant to be skippable. Converting
                  "" to undefined here is what actually makes it skippable. */}
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="Choisir la couleur de marque"
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
                Logo
              </label>
              <div className="flex items-center gap-3">
                {watchedLogo && (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary/uploaded URL, not a static asset
                  <img src={watchedLogo} alt="" className="h-10 w-10 rounded object-contain" />
                )}
                <Input
                  id="org-logo"
                  className="w-full"
                  placeholder="https://... ou envoyez un fichier"
                  error={!!orgErrors.logo}
                  {...registerOrg("logo", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
                />
                <input
                  ref={logoFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Envoyer un fichier pour le logo"
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
                  Envoyer
                </Button>
              </div>
              {orgErrors.logo && (
                <p className="mt-1 text-xs text-destructive">{orgErrors.logo.message}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-tagline">
                Slogan (affiché sur votre page publique)
              </label>
              <Input
                id="org-tagline"
                className="w-full"
                placeholder="ex: Le meilleur salon de la ville"
                error={!!orgErrors.tagline}
                {...registerOrg("tagline", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
              />
              {orgErrors.tagline && (
                <p className="mt-1 text-xs text-destructive">{orgErrors.tagline.message}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-hero-image">
                Image de bannière (page publique)
              </label>
              <div className="flex items-center gap-3">
                {watchedHeroImage && (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary/uploaded URL, not a static asset
                  <img src={watchedHeroImage} alt="" className="h-10 w-16 rounded object-cover" />
                )}
                <Input
                  id="org-hero-image"
                  className="w-full"
                  placeholder="https://... ou envoyez un fichier"
                  error={!!orgErrors.heroImage}
                  {...registerOrg("heroImage", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
                />
                <input
                  ref={heroImageFileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Envoyer un fichier pour la bannière"
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
                  Envoyer
                </Button>
              </div>
              {orgErrors.heroImage && (
                <p className="mt-1 text-xs text-destructive">{orgErrors.heroImage.message}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="org-shipping-flat-rate">
                Frais de livraison (boutique en ligne)
              </label>
              <Input
                id="org-shipping-flat-rate"
                type="number"
                step="0.01"
                className="w-full"
                placeholder="Gratuit"
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
                  Sections visibles sur la page publique
                </p>
                <div className="flex flex-wrap gap-4">
                  {organization.enabledModules.includes("catalog") && (
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        value="catalog"
                        {...registerOrg("storefrontSections")}
                      />
                      Afficher le catalogue
                    </label>
                  )}
                  {organization.enabledModules.includes("booking") && (
                    <label className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        value="booking"
                        {...registerOrg("storefrontSections")}
                      />
                      Afficher les réservations
                    </label>
                  )}
                </div>
              </div>
            )}

            {organization?.enabledModules.includes("commerce") && (
              <div className="sm:col-span-2">
                <p className="mb-1 text-xs font-medium text-text">
                  Moyens de paiement acceptés à la commande
                </p>
                <p className="mb-2 text-xs text-text-muted">
                  &quot;En ligne&quot; ne s&apos;affiche à vos clients que si un moyen de paiement
                  réel est connecté (voir Intégrations) — cochez-le dès maintenant si vous
                  comptez en connecter un.
                </p>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      value="cash"
                      {...registerOrg("acceptedPaymentMethods")}
                    />
                    Espèces / à la livraison ou au retrait
                  </label>
                  <label className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="checkbox"
                      value="online"
                      {...registerOrg("acceptedPaymentMethods")}
                    />
                    Paiement en ligne
                  </label>
                </div>
              </div>
            )}

            {uploadError && (
              <p className="text-sm text-destructive sm:col-span-2">{uploadError}</p>
            )}

            {updateOrgMutation.isError && (
              <p className="text-sm text-destructive sm:col-span-2">
                {updateOrgMutation.error instanceof ApiError
                  ? updateOrgMutation.error.message
                  : "Impossible d'enregistrer les informations de l'organisation."}
              </p>
            )}

            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" loading={updateOrgMutation.isPending}>
                {updateOrgMutation.isPending ? "Enregistrement..." : "Enregistrer"}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelOrgEdit}>
                Annuler
              </Button>
            </div>
          </form>
        )}
      </section>

      {organization?.slug && (
        <StorefrontPreviewSection
          slug={organization.slug}
          previewTemplate={orgEditOpen ? watchedStorefrontTemplate : undefined}
          previewPalette={orgEditOpen ? watchedStorefrontPalette : undefined}
          previewFontPairing={orgEditOpen ? watchedStorefrontFontPairing : undefined}
        />
      )}

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-text">Abonnement</h2>
        {subscription && (
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{subscription.plan.name}</p>
                <p className="text-xs text-text-muted">
                  {subscription.plan.priceAmount} {subscription.plan.priceCurrency} / {subscription.plan.interval === "month" ? "mois" : "an"}
                </p>
              </div>
              <Badge variant="success">
                {subscription.subscription.status === "active" ? "Actif" : subscription.subscription.status}
              </Badge>
            </div>

            <div className="space-y-2">
              {subscription.usage.map((item) => (
                <div key={item.metric} className="text-xs">
                  <div className="mb-1 flex justify-between text-text-muted">
                    <span>{METRIC_LABELS[item.metric] ?? item.metric}</span>
                    <span>
                      {item.used} / {item.limit === -1 ? "illimité" : item.limit}
                    </span>
                  </div>
                  {item.limit !== -1 && (
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-zinc-900"
                        style={{ width: `${Math.min(100, (item.used / item.limit) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {changePlanMutation.isError && (
              <p className="text-xs text-destructive">
                {changePlanMutation.error instanceof ApiError
                  ? changePlanMutation.error.message
                  : "Erreur"}
              </p>
            )}

            {aiUsage && !aiUsagePermissionDenied && (
              <div className="border-t border-border pt-4">
                <div className="mb-1 flex justify-between text-xs text-text-muted">
                  <span>Coût IA ce mois-ci ({aiUsage.period})</span>
                  <span>{formatCurrency(aiUsage.costUsd, "USD")}</span>
                </div>
                <p className="text-xs text-text-muted">
                  {(aiUsage.inputTokens + aiUsage.outputTokens).toLocaleString("fr-FR")} tokens
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
                    {plan.key === subscription.plan.key ? "Plan actuel" : "Choisir"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Modules</h2>
          {modulesMutation.isPending && (
            <span className="text-xs text-text-muted">Enregistrement...</span>
          )}
        </div>
        <p className="mt-1 text-sm text-text-muted">
          Activez ou désactivez les modules disponibles dans votre plan actuel. Le menu à
          gauche se met à jour immédiatement.
        </p>

        {modulesMutation.isError && (
          <p className="mt-3 text-xs text-destructive">
            {modulesMutation.error instanceof ApiError
              ? modulesMutation.error.message
              : "Impossible de mettre à jour les modules. Réessayez."}
          </p>
        )}

        {!organization || !subscription ? (
          <p className="mt-4 text-sm text-text-muted">Chargement...</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {KORVA_MODULES.map((module) => {
              const isEnabled = organization.enabledModules.includes(module);
              const isAllowedByPlan = subscription.plan.modules.includes(module);
              const disabled = !isAllowedByPlan || modulesMutation.isPending;
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
                    {MODULE_LABELS[module]}
                  </span>
                  {!isAllowedByPlan && <Badge>Non inclus dans le plan</Badge>}
                </label>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Équipe</h2>
          <Button variant="secondary" size="sm" onClick={() => setInviteOpen((v) => !v)}>
            {inviteOpen ? "Annuler" : "Inviter un membre"}
          </Button>
        </div>

        {inviteOpen && (
          <form
            onSubmit={handleInviteSubmit((values) => inviteMemberMutation.mutate(values))}
            className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-border p-4 sm:grid-cols-2"
          >
            <div>
              <label className="block text-sm font-medium text-text" htmlFor="invite-email">
                Adresse email
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
                Rôle
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
                    ? "Chargement des rôles..."
                    : rolesError
                      ? "Rôles indisponibles"
                      : roles && roles.length === 0
                        ? "Aucun rôle disponible"
                        : "Sélectionner un rôle"}
                </option>
                {roles?.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              {rolesError && (
                <div className="mt-1">
                  <p className="text-xs text-destructive">Impossible de charger les rôles.</p>
                  <button
                    type="button"
                    onClick={() => void refetchRoles()}
                    className="text-xs font-medium text-text underline"
                  >
                    Réessayer
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
                  : "Impossible d'envoyer l'invitation. Réessayez."}
              </p>
            )}

            {inviteMemberMutation.isSuccess && (
              <p className="text-sm text-text sm:col-span-2">
                Invitation envoyée par email. Elle apparaîtra ci-dessous jusqu&apos;à ce qu&apos;elle soit acceptée.
              </p>
            )}

            <Button
              type="submit"
              className="sm:col-span-2"
              loading={inviteMemberMutation.isPending}
              disabled={rolesLoading || rolesError || (roles?.length ?? 0) === 0}
            >
              {inviteMemberMutation.isPending ? "Invitation en cours..." : "Envoyer l'invitation"}
            </Button>
          </form>
        )}

        <div className="mt-4 divide-y divide-border">
          {isLoading && <p className="py-2 text-sm text-text-muted">Chargement...</p>}
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
                        {isSelf && <span className="text-xs text-text-muted"> (vous)</span>}
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
                              {isRemovePending ? "Retrait..." : "Confirmer ?"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isRemovePending}
                              onClick={() => setRemoveConfirmId(null)}
                            >
                              Annuler
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setRemoveConfirmId(member.id)}
                          >
                            Retirer
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                    <label htmlFor={`rate-${member.id}`}>Taux horaire par défaut</label>
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
                            : "Erreur"}
                        </span>
                      )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                    <label htmlFor={`commission-${member.id}`}>Commission (%)</label>
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
                            : "Erreur"}
                        </span>
                      )}
                  </div>
                  {roleChangeError && (
                    <p className="mt-1 text-xs text-destructive">
                      {roleChangeError instanceof ApiError
                        ? roleChangeError.message
                        : "Impossible de modifier le rôle."}
                    </p>
                  )}
                  {removeError && (
                    <p className="mt-1 text-xs text-destructive">
                      {removeError instanceof ApiError
                        ? removeError.message
                        : "Impossible de retirer ce membre."}
                    </p>
                  )}
                </div>
              );
            })}
        </div>

        {pendingInvitations && pendingInvitations.length > 0 && (
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase text-text-muted">
              Invitations en attente
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
                    {roles?.find((role) => role.id === invitation.roleId)?.name ??
                      "En attente"}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-text">Intégrations</h2>
        <p className="mt-1 text-sm text-text-muted">
          Connectez les services externes utilisés par votre organisation.
        </p>

        {integrationsPermissionDenied ? (
          <p className="mt-4 text-sm text-text-muted">
            Les intégrations sont réservées aux administrateurs.
          </p>
        ) : integrationsLoading ? (
          <p className="mt-4 text-sm text-text-muted">Chargement...</p>
        ) : integrationsIsError ? (
          <div className="mt-4">
            <p className="text-sm text-destructive">
              {integrationsError instanceof ApiError
                ? integrationsError.message
                : "Impossible de charger les intégrations."}
            </p>
            <button
              type="button"
              onClick={() => void refetchIntegrations()}
              className="mt-1 text-sm font-medium text-text underline"
            >
              Réessayer
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
                  ? paymentProviderDisplayName(integration.provider)
                  : undefined;
              const title = providerName ? `${slot.title} — ${providerName}` : slot.title;
              const description = providerName
                ? `Recevez vos règlements via ${providerName}.`
                : slot.description;

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
                        ? INTEGRATION_STATUS_BADGE[integration.status].label
                        : "Non connecté"}
                    </Badge>
                  </div>

                  {integration && (integration.market || integration.lastVerifiedAt) && (
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-text-muted">
                      {integration.market && (
                        <div>
                          <dt>{slot.connectedLabel}</dt>
                          <dd className="text-text">{integration.market}</dd>
                        </div>
                      )}
                      {integration.lastVerifiedAt && (
                        <div>
                          <dt>Dernière vérification</dt>
                          <dd className="text-text">
                            {new Date(integration.lastVerifiedAt).toLocaleString("fr-FR")}
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
                        (testResult.ok ? "Connexion réussie." : "Échec de la connexion.")}
                    </p>
                  )}
                  {testError && (
                    <p className="mt-2 text-xs text-destructive">
                      {testError instanceof ApiError
                        ? testError.message
                        : "Impossible de tester la connexion."}
                    </p>
                  )}
                  {disconnectError && (
                    <p className="mt-2 text-xs text-destructive">
                      {disconnectError instanceof ApiError
                        ? disconnectError.message
                        : "Impossible de déconnecter cette intégration."}
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
                        {isFormOpen ? "Annuler" : "Connecter"}
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
                          {isTestingThis ? "Test en cours..." : "Tester la connexion"}
                        </Button>
                        {isConfirmingDisconnect ? (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              loading={isDisconnectPending}
                              onClick={() => disconnectMutation.mutate(integration.id)}
                            >
                              {isDisconnectPending ? "Déconnexion..." : "Confirmer ?"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isDisconnectPending}
                              onClick={() => setDisconnectConfirmId(null)}
                            >
                              Annuler
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDisconnectConfirmId(integration.id)}
                          >
                            Déconnecter
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
                          Code banque (Flutterwave)
                        </label>
                        <Input
                          id="payout-account-bank"
                          className="mt-1 w-full"
                          placeholder="ex : 044"
                          error={!!paymentErrors.account_bank}
                          {...registerPayment("account_bank", { required: true })}
                        />
                        <p className="mt-1 text-xs text-text-muted">
                          Code numérique de la banque chez Flutterwave, pas son nom.
                        </p>
                      </div>
                      <div>
                        <label
                          className="block text-sm font-medium text-text"
                          htmlFor="payout-account-number"
                        >
                          Numéro de compte
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
                          Nom de l&apos;entreprise
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
                          Pays (code ISO)
                        </label>
                        <Input
                          id="payout-country"
                          className="mt-1 w-full"
                          placeholder="ex : CI"
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
                          Type de répartition
                        </label>
                        <select
                          id="payout-split-type"
                          className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
                          {...registerPayment("split_type", { required: true })}
                        >
                          <option value="percentage">Pourcentage</option>
                          <option value="flat">Montant fixe</option>
                        </select>
                      </div>
                      <div>
                        <label
                          className="block text-sm font-medium text-text"
                          htmlFor="payout-split-value"
                        >
                          Valeur de répartition
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
                            : "Impossible de connecter le compte de paiement."}
                        </p>
                      )}

                      <Button
                        type="submit"
                        className="sm:col-span-2"
                        loading={connectPaymentMutation.isPending}
                      >
                        {connectPaymentMutation.isPending ? "Connexion..." : "Connecter"}
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
                        Le WABA ID, l&apos;ID du numéro de téléphone et la clé API proviennent de
                        l&apos;inscription WhatsApp Business que vous avez complétée directement
                        chez 360dialog (embedded signup) — ces informations ne sont pas saisies
                        ici pour la première fois.
                      </p>
                      <div>
                        <label
                          className="block text-sm font-medium text-text"
                          htmlFor="waba-id"
                        >
                          WABA ID
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
                          ID du numéro de téléphone
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
                          Nom affiché
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
                          Clé API (D360-API-KEY)
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
                          Stockée chiffrée et jamais réaffichée ensuite — nécessaire pour tester
                          la connexion et activer l&apos;intégration.
                        </p>
                      </div>

                      {connectMessagingMutation.isError && (
                        <p className="text-sm text-destructive sm:col-span-2">
                          {connectMessagingMutation.error instanceof ApiError
                            ? connectMessagingMutation.error.message
                            : "Impossible de connecter le compte WhatsApp Business."}
                        </p>
                      )}

                      <Button
                        type="submit"
                        className="sm:col-span-2"
                        loading={connectMessagingMutation.isPending}
                      >
                        {connectMessagingMutation.isPending ? "Connexion..." : "Connecter"}
                      </Button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {organization && <ExternalWebsiteSection slug={organization.slug} />}
      <WebhookSubscriptionsSection />
      <RolesManagementSection />
      <CustomFieldsSection />
      <StorefrontContentSection />
      <AuditLogSection />
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
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const { data: roles, isLoading } = useQuery({
    queryKey: ["roles"],
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
          <h2 className="text-sm font-semibold text-text">Rôles personnalisés</h2>
          <p className="mt-1 text-sm text-text-muted">
            En plus des 6 rôles standards, créez des rôles avec exactement les permissions dont
            vos équipes ont besoin.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => setCreateOpen((v) => !v)}>
          {createOpen ? "Annuler" : "Créer un rôle"}
        </Button>
      </div>

      {createOpen && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="mt-4 space-y-3 rounded-md border border-border p-4"
        >
          <div>
            <Input placeholder="Nom du rôle" className="w-full" error={!!errors.name} {...register("name")} />
            {errors.name && <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-text">Permissions</p>
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
                : "Impossible de créer ce rôle."}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? "Création..." : "Créer le rôle"}
          </Button>
        </form>
      )}

      {isLoading ? (
        <p className="mt-4 text-sm text-text-muted">Chargement...</p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {roles?.map((role) => (
            <li key={role.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-text">{role.name}</span>
                {role.isSystem ? (
                  <Badge>Standard</Badge>
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
                  Supprimer
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
            : "Impossible de supprimer ce rôle."}
        </p>
      )}
    </section>
  );
}

const CUSTOM_FIELD_ENTITY_LABELS: Record<CustomFieldEntity, string> = {
  contacts: "Contacts",
  leads: "Prospects",
  offers: "Produits & services",
  bookings: "Réservations",
  orders: "Commandes",
};

const CUSTOM_FIELD_TYPE_LABELS: Record<CreateCustomFieldInput["type"], string> = {
  text: "Texte",
  number: "Nombre",
  boolean: "Case à cocher",
  date: "Date",
  datetime: "Date et heure",
  select: "Liste déroulante",
  multiselect: "Choix multiples",
  email: "Email",
  phone: "Téléphone",
  url: "URL",
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
  const queryClient = useQueryClient();
  const [entity, setEntity] = useState<CustomFieldEntity>("contacts");
  const [createOpen, setCreateOpen] = useState(false);
  const [optionsInput, setOptionsInput] = useState("");

  const { data: fields, isLoading } = useQuery({
    queryKey: ["custom-fields", entity],
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
          <h2 className="text-sm font-semibold text-text">Champs personnalisés</h2>
          <p className="mt-1 text-sm text-text-muted">
            Ajoutez des champs propres à votre activité sur les contacts, prospects, produits,
            réservations et commandes.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setCreateOpen((v) => !v)}
        >
          {createOpen ? "Annuler" : "Ajouter un champ"}
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
            {CUSTOM_FIELD_ENTITY_LABELS[option]}
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
              Clé (identifiant technique)
            </label>
            <Input
              id="custom-field-key"
              placeholder="ex. surface_m2"
              error={!!errors.key}
              {...register("key")}
            />
            {errors.key && <p className="mt-1 text-xs text-destructive">{errors.key.message}</p>}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text" htmlFor="custom-field-label">
              Libellé affiché
            </label>
            <Input
              id="custom-field-label"
              placeholder="ex. Surface (m²)"
              error={!!errors.label}
              {...register("label")}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text" htmlFor="custom-field-type">
              Type
            </label>
            <Select id="custom-field-type" className="w-full" {...register("type")}>
              {CUSTOM_FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {CUSTOM_FIELD_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 self-end text-sm text-text">
            <input type="checkbox" {...register("required")} />
            Obligatoire
          </label>
          {CUSTOM_FIELD_TYPES_WITH_OPTIONS.has(selectedType) && (
            <div className="col-span-2">
              <label
                className="mb-1 block text-xs font-medium text-text"
                htmlFor="custom-field-options"
              >
                Options (séparées par des virgules)
              </label>
              <Input
                id="custom-field-options"
                className="w-full"
                placeholder="ex. Petit, Moyen, Grand"
                value={optionsInput}
                onChange={(e) => setOptionsInput(e.target.value)}
              />
            </div>
          )}
          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {createMutation.error instanceof ApiError
                ? createMutation.error.message
                : "Impossible de créer ce champ."}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? "Création..." : "Créer le champ"}
          </Button>
        </form>
      )}

      {isLoading ? (
        <p className="mt-4 text-sm text-text-muted">Chargement...</p>
      ) : fields?.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">
          Aucun champ personnalisé pour {CUSTOM_FIELD_ENTITY_LABELS[entity].toLowerCase()}.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {fields?.map((field) => (
            <li key={field.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-text">{field.label}</span>
                <Badge>{CUSTOM_FIELD_TYPE_LABELS[field.type]}</Badge>
                {field.required && <Badge>Obligatoire</Badge>}
                <span className="text-xs text-text-muted">{field.key}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={deleteMutation.isPending && deleteMutation.variables === field.id}
                onClick={() => deleteMutation.mutate(field.id)}
              >
                Supprimer
              </Button>
            </li>
          ))}
        </ul>
      )}
      {deleteMutation.isError && (
        <p className="mt-2 text-sm text-destructive">
          {deleteMutation.error instanceof ApiError
            ? deleteMutation.error.message
            : "Impossible de supprimer ce champ."}
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
const WIDGET_MODE_OPTIONS: { value: string; label: string; description: string }[] = [
  {
    value: "leads",
    label: "Capture de contacts",
    description: "Un formulaire simple pour recevoir des demandes de contact.",
  },
  {
    value: "catalog",
    label: "Boutique",
    description: "Vos visiteurs parcourent votre catalogue et commandent directement.",
  },
  {
    value: "booking",
    label: "Réservation",
    description: "Vos visiteurs réservent un créneau directement.",
  },
  {
    value: "full",
    label: "Boutique + réservation",
    description: "Les deux, avec des onglets dans le widget.",
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
  const [open, setOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3001";
  const previewParams = new URLSearchParams();
  if (previewTemplate) previewParams.set("template", previewTemplate);
  if (previewPalette) previewParams.set("palette", previewPalette);
  if (previewFontPairing) previewParams.set("font", previewFontPairing);
  const query = previewParams.toString();
  const storefrontPageUrl = `${storefrontUrl}/${slug}${query ? `?${query}` : ""}`;

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text">Aperçu de ma page publique</h2>
        <div className="flex items-center gap-2">
          {open && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              Rafraîchir
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? "Masquer" : "Afficher"}
          </Button>
        </div>
      </div>
      {open && (
        <iframe
          key={`${reloadKey}-${query}`}
          src={storefrontPageUrl}
          title="Aperçu de la page publique"
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
  const { data: organization, isLoading } = useActiveOrganization();
  const { data: subscription } = useQuery({
    queryKey: ["subscriptions", "me"],
    queryFn: () => apiClient.get<SubscriptionSummary>("/subscriptions/me"),
  });
  const planKey = subscription?.plan.key;
  const allowed = !planKey || planMeetsMinimum(planKey, "pro");

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text">Contenu de la page publique</h2>
          <p className="mt-1 text-sm text-text-muted">
            Présentez votre entreprise comme un vrai site professionnel : à propos, équipe,
            galerie et avis clients.
          </p>
        </div>
        {!allowed && <Badge>🔒 Passer au plan Pro</Badge>}
      </div>
      {!isLoading && organization && (
        <fieldset disabled={!allowed} className="mt-4 space-y-6 disabled:opacity-60">
          <AboutTextEditor organization={organization} />
          <TestimonialsEditor organization={organization} />
          <TeamMembersEditor organization={organization} />
          <GalleryEditor organization={organization} />
        </fieldset>
      )}
    </section>
  );
}

function AboutTextEditor({ organization }: { organization: Organization }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(organization.aboutText ?? "");
  const mutation = useMutation({
    mutationFn: (aboutText: string) =>
      apiClient.patch<Organization>("/organizations/me", { aboutText }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-text">À propos</p>
      <textarea
        className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
        rows={4}
        maxLength={4000}
        placeholder="Racontez l'histoire de votre entreprise..."
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
          {mutation.isPending ? "Enregistrement..." : "Enregistrer le texte"}
        </Button>
        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : "Erreur"}
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
        <p className="text-xs font-medium text-text">Témoignages clients</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          Ajouter un témoignage
        </Button>
      </div>
      {testimonials.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">Aucun témoignage.</p>
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
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="Ajouter un témoignage">
        <form onSubmit={handleSubmit(addTestimonial)} className="space-y-3">
          <Input placeholder="Nom du client" {...register("authorName", { required: true })} />
          <Input placeholder="Rôle / entreprise (optionnel)" {...register("role")} />
          <textarea
            placeholder="Témoignage"
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={3}
            {...register("quote", { required: true })}
          />
          <Input
            type="number"
            min={1}
            max={5}
            placeholder="Note sur 5 (optionnel)"
            {...register("rating", {
              setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
            })}
          />
          {mutation.isError && (
            <p className="text-xs text-destructive">
              {mutation.error instanceof ApiError ? mutation.error.message : "Erreur"}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? "Ajout..." : "Ajouter"}
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
      setUploadError(error instanceof ApiError ? error.message : "Échec de l'envoi du fichier.");
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
        <p className="text-xs font-medium text-text">Équipe</p>
        <Button type="button" variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
          Ajouter un membre
        </Button>
      </div>
      {teamMembers.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">Aucun membre.</p>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {teamMembers.map((member) => (
            <li
              key={member.id}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-3 text-sm"
            >
              <div>
                <p className="font-medium text-text">{member.name}</p>
                <p className="text-xs uppercase tracking-wide text-text-muted">{member.role}</p>
              </div>
              <button
                type="button"
                onClick={() => removeTeamMember(member.id)}
                className="shrink-0 text-xs text-destructive hover:underline"
              >
                Supprimer
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Ajouter un membre de l'équipe"
      >
        <form onSubmit={handleSubmit(addTeamMember)} className="space-y-3">
          <Input placeholder="Nom" {...register("name", { required: true })} />
          <Input placeholder="Rôle" {...register("role", { required: true })} />
          <textarea
            placeholder="Bio (optionnel)"
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
              {photoUrl ? "Changer la photo" : "Ajouter une photo"}
            </Button>
            {photoUrl && <span className="text-xs text-text-muted">Photo ajoutée</span>}
          </div>
          {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
          {mutation.isError && (
            <p className="text-xs text-destructive">
              {mutation.error instanceof ApiError ? mutation.error.message : "Erreur"}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setAddOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {mutation.isPending ? "Ajout..." : "Ajouter"}
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

function GalleryEditor({ organization }: { organization: Organization }) {
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
      setUploadError(error instanceof ApiError ? error.message : "Échec de l'envoi du fichier.");
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
        <p className="text-xs font-medium text-text">Galerie photo</p>
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
          Ajouter une image
        </Button>
      </div>
      {uploadError && <p className="mt-2 text-xs text-destructive">{uploadError}</p>}
      {mutation.isError && (
        <p className="mt-2 text-xs text-destructive">
          {mutation.error instanceof ApiError ? mutation.error.message : "Erreur"}
        </p>
      )}
      {galleryImages.length === 0 ? (
        <p className="mt-2 text-sm text-text-muted">Aucune image.</p>
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
  const effectiveTemplateKey = selectedTemplate ?? "essentiel";
  const currentTemplate =
    STOREFRONT_TEMPLATES.find((t) => t.key === effectiveTemplateKey) ?? STOREFRONT_TEMPLATES[0];
  const canRefine = !planKey || planMeetsMinimum(planKey, currentTemplate.refinedChoiceMinPlan);

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-text">Gabarit de la page publique</p>
      <p className="mb-2 text-xs text-text-muted">
        Chaque gabarit propose une mise en page différente, pensée pour un secteur d&apos;activité.
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
                {!isAllowed && <Badge>Non inclus dans le plan</Badge>}
              </span>
              <span className="mt-0.5 block text-xs text-text-muted">{template.description}</span>
            </button>
          );
        })}
      </div>

      {currentTemplate.palettes.length > 0 && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="mb-1 text-xs font-medium text-text">Palette de couleurs</p>
            <div className="flex flex-wrap gap-2">
              {currentTemplate.palettes.map((paletteKey, index) => {
                const palette = STOREFRONT_PALETTES[paletteKey];
                const isAllowed = index === 0 || canRefine;
                const isSelected = (selectedPalette ?? currentTemplate.palettes[0]) === paletteKey;
                return (
                  <button
                    key={paletteKey}
                    type="button"
                    disabled={!isAllowed}
                    onClick={() => onChangePalette(paletteKey)}
                    title={isAllowed ? palette.label : `${palette.label} — nécessite un plan supérieur`}
                    className={`flex items-center gap-2 rounded-full border px-2 py-1 text-xs ${
                      isSelected ? "border-text" : "border-border"
                    } ${!isAllowed ? "opacity-50" : ""}`}
                  >
                    <span
                      className="h-4 w-4 rounded-full border border-border-input"
                      style={{ backgroundColor: palette.accent }}
                    />
                    {palette.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-text">Police</p>
            <div className="flex flex-wrap gap-2">
              {currentTemplate.fontPairings.map((fontKey, index) => {
                const font = STOREFRONT_FONT_PAIRINGS[fontKey];
                const isAllowed = index === 0 || canRefine;
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
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState("leads");
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
  const storefrontUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3001";
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
        <h2 className="text-sm font-semibold text-text">Mon site existant</h2>
        <a
          href={storefrontPageUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-text underline-offset-2 hover:underline"
        >
          Voir ma page publique →
        </a>
      </div>
      <p className="mt-1 text-sm text-text-muted">
        Ajoutez ce widget sur votre site web actuel pour interagir avec vos visiteurs directement
        depuis KORVA.
      </p>

      <label className="mt-4 block text-sm">
        <span className="mb-1 block text-text-muted">Ce que le widget doit faire</span>
        <Select value={mode} onChange={(event) => setMode(event.target.value)} className="w-full sm:w-72">
          {WIDGET_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        {selectedOption && (
          <span className="mt-1 block text-xs text-text-muted">{selectedOption.description}</span>
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
        {copied ? "Copié !" : "Copier le code"}
      </Button>
    </section>
  );
}

const WEBHOOK_EVENT_LABELS: Record<string, string> = {
  "lead.created": "Prospect créé",
  "quote.created": "Devis créé",
  "quote.accepted": "Devis accepté",
  "quote.expired": "Devis expiré",
  "order.created": "Commande créée",
  "payment.completed": "Paiement complété",
  "booking.created": "Réservation créée",
  "booking.cancelled": "Réservation annulée",
  "customer.created": "Client créé",
  "invoice.overdue": "Facture en retard",
  "customer.inactive": "Client inactif",
  "payment.webhook_received": "Webhook paiement reçu",
  "whatsapp.status_updated": "Statut WhatsApp mis à jour",
  "offer.created": "Offre créée",
  "message.sent": "Message envoyé",
  "subscription.plan_changed": "Plan d'abonnement changé",
  "expense.created": "Dépense créée",
  "recurring_billing.created": "Abonnement client créé",
  "recurring_billing.charged": "Abonnement client facturé",
  "recurring_billing.cancelled": "Abonnement client résilié",
  "return_request.created": "Demande de retour créée",
  "return_request.approved": "Retour approuvé (remboursé)",
  "return_request.rejected": "Retour refusé",
};

/**
 * A first-class outbound-webhook subscription system for external partners — signed deliveries
 * (HMAC), retry/backoff, and a per-subscription delivery log, distinct from the Workflow
 * Engine's own `webhook` action (see docs/BUSINESS_OS_AUDIT.md §6). The secret is shown exactly
 * once (at creation and at each rotation), same posture as any bearer credential in this product.
 */
function WebhookSubscriptionsSection() {
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
      <h2 className="text-sm font-semibold text-text">Webhooks sortants</h2>
      <p className="mt-1 text-sm text-text-muted">
        Envoyez automatiquement les événements KORVA (signés, avec nouvelles tentatives) vers un
        logiciel partenaire.
      </p>

      {revealedSecret && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Clé secrète générée — notez-la maintenant, elle ne sera plus jamais affichée.
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
              {copied ? "Copié !" : "Copier"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setRevealedSecret(null)}>
              Fermer
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
        <Input placeholder="Description (optionnel)" className="w-full" {...register("description")} />
        <div>
          <p className="mb-1 text-xs font-medium text-text">Événements</p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {SYSTEM_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm text-text">
                <input type="checkbox" value={event} {...register("events")} />
                {WEBHOOK_EVENT_LABELS[event] ?? event}
              </label>
            ))}
          </div>
          {errors.events && (
            <p className="mt-1 text-xs text-destructive">Sélectionnez au moins un événement.</p>
          )}
        </div>
        {createMutation.isError && (
          <p className="text-sm text-destructive">
            {createMutation.error instanceof ApiError
              ? createMutation.error.message
              : "Impossible de créer ce webhook."}
          </p>
        )}
        <Button type="submit" loading={createMutation.isPending}>
          {createMutation.isPending ? "Création..." : "Ajouter un webhook"}
        </Button>
      </form>

      <div className="mt-4 space-y-2">
        {isLoading && <p className="text-sm text-text-muted">Chargement...</p>}
        {!isLoading && subscriptions?.length === 0 && (
          <p className="text-sm text-text-muted">Aucun webhook sortant configuré.</p>
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
                    <Badge key={event}>{WEBHOOK_EVENT_LABELS[event] ?? event}</Badge>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={subscription.active ? "success" : "default"}>
                  {subscription.active ? "Actif" : "Inactif"}
                </Badge>
                {subscription.lastDeliveryStatus && (
                  <Badge variant={subscription.lastDeliveryStatus === "success" ? "success" : "destructive"}>
                    Dernière livraison : {subscription.lastDeliveryStatus === "success" ? "OK" : "échec"}
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
                {subscription.active ? "Désactiver" : "Activer"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => rotateMutation.mutate(subscription.id)}
                loading={rotateMutation.isPending && rotateMutation.variables === subscription.id}
              >
                Régénérer la clé
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setExpandedId(expandedId === subscription.id ? null : subscription.id)}
              >
                {expandedId === subscription.id ? "Masquer les livraisons" : "Voir les livraisons"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => deleteMutation.mutate(subscription.id)}
                loading={deleteMutation.isPending && deleteMutation.variables === subscription.id}
              >
                Supprimer
              </Button>
            </div>

            {expandedId === subscription.id && (
              <div className="mt-3 border-t border-border pt-3">
                {deliveriesQuery.isLoading && (
                  <p className="text-xs text-text-muted">Chargement des livraisons...</p>
                )}
                {deliveriesQuery.data?.length === 0 && (
                  <p className="text-xs text-text-muted">Aucune livraison pour le moment.</p>
                )}
                {deliveriesQuery.data && deliveriesQuery.data.length > 0 && (
                  <ul className="space-y-1">
                    {deliveriesQuery.data.map((delivery) => (
                      <li key={delivery.id} className="flex items-center justify-between text-xs">
                        <span className="text-text-muted">
                          {WEBHOOK_EVENT_LABELS[delivery.eventName] ?? delivery.eventName}
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

const AUDIT_ACTION_LABELS: Record<string, string> = {
  CREATE: "Création",
  UPDATE: "Modification",
  DELETE: "Suppression",
  LOGIN: "Connexion",
  LOGOUT: "Déconnexion",
  PAYMENT: "Paiement",
  REFUND: "Remboursement",
  BOOKING: "Réservation",
  AI_ACTION: "Action IA",
  ROLE_CHANGE: "Changement de rôle",
  SETTINGS_CHANGE: "Changement de paramètres",
};

/** First read UI for AuditService.record — see apps/api/src/audit/audit.controller.ts. */
function AuditLogSection() {
  const [page, setPage] = useState(1);
  const limit = 20;
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs", page],
    queryFn: () => apiClient.getList<AuditLogEntry>(`/audit-logs?page=${page}&limit=${limit}`),
  });

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="text-sm font-semibold text-text">Journal d&apos;audit</h2>
      <p className="mt-1 text-sm text-text-muted">
        Historique des actions effectuées sur votre organisation (créations, modifications,
        paiements...).
      </p>

      {isLoading ? (
        <p className="mt-4 text-sm text-text-muted">Chargement...</p>
      ) : !data || data.data.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">Aucune entrée pour le moment.</p>
      ) : (
        <>
          <ul className="mt-4 divide-y divide-border">
            {data.data.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge>{AUDIT_ACTION_LABELS[entry.action] ?? entry.action}</Badge>
                  <span className="text-text">{entry.entity}</span>
                  {entry.entityId && (
                    <span className="text-xs text-text-muted">#{entry.entityId.slice(-6)}</span>
                  )}
                </div>
                <span className="text-xs text-text-muted">
                  {new Date(entry.createdAt).toLocaleString("fr-FR")}
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
              Précédent
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
              Suivant
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
