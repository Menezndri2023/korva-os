"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KORVA_MODULES } from "@korva/types";
import type {
  ConnectMessagingAccountInput,
  ConnectPaymentPayoutInput,
  IntegrationAccountStatus,
  IntegrationDomain,
  IntegrationSummary,
  KorvaModule,
  Organization,
  Plan,
  SubscriptionSummary,
  TestConnectionResult,
} from "@korva/types";
import { addMemberSchema, type AddMemberInput } from "@korva/validation";
import { Badge, Button, Input } from "@korva/ui";
import type { BadgeVariant } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useAuthReady } from "@/lib/use-auth-ready";

interface MemberRow {
  id: string;
  status: string;
  userId: { id: string; email: string; firstName?: string; lastName?: string };
  roleId: { id: string; name: string; systemKey?: string };
}

interface RoleOption {
  id: string;
  name: string;
  systemKey?: string;
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
    domain: "payment",
    title: "Paiements — Flutterwave",
    description: "Recevez vos règlements via Flutterwave.",
    connectedLabel: "Marché",
  },
  {
    domain: "messaging",
    title: "WhatsApp Business — 360dialog",
    description: "Envoyez et recevez des messages WhatsApp avec vos clients.",
    connectedLabel: "Compte connecté",
  },
];

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

// Flutterwave's exact required payout field names are owned by a different Stage 2 lot
// (the PaymentProvider adapter) that this frontend cannot see — see
// ConnectPaymentPayoutInput's doc comment in packages/types/src/integrations.ts. These three
// keys (bankName/accountNumber/accountHolderName) are a reasonable, clearly-labeled common
// subset and are EXPECTED to need reconciling against the real adapter at convergence.
interface PaymentPayoutFormValues {
  bankName: string;
  accountNumber: string;
  accountHolderName: string;
}

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { data: organization } = useActiveOrganization();
  const authReady = useAuthReady();
  const { data: members, isLoading } = useQuery({
    queryKey: ["organizations", "me", "members"],
    queryFn: () => apiClient.get<MemberRow[]>("/organizations/me/members"),
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

  // Not optimistic, same reasoning as F1's modulesMutation: the member list is the source of
  // truth, and onSuccess returns (not `void`) the invalidated refetch so isPending — and the
  // submit button's disabled state — covers the full round trip, not just the POST itself.
  const inviteMemberMutation = useMutation({
    mutationFn: (input: AddMemberInput) =>
      apiClient.post<MemberRow>("/organizations/me/members", input),
    onSuccess: () => {
      resetInviteForm();
      return queryClient.invalidateQueries({ queryKey: ["organizations", "me", "members"] });
    },
  });

  const changePlanMutation = useMutation({
    mutationFn: (planKey: string) =>
      apiClient.post("/subscriptions/change-plan", { planKey }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["subscriptions", "me"] }),
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
        bankName: values.bankName,
        accountNumber: values.accountNumber,
        accountHolderName: values.accountHolderName,
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
        <h2 className="text-sm font-semibold text-text">Organisation</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-text-muted">Nom</dt>
            <dd className="mt-0.5">{organization?.name ?? "—"}</dd>
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
        </dl>
      </section>

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
              <p className="text-sm text-text sm:col-span-2">Invitation envoyée.</p>
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
          {members?.map((member) => (
            <div key={member.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <p className="font-medium">
                  {member.userId.firstName
                    ? `${member.userId.firstName} ${member.userId.lastName ?? ""}`.trim()
                    : member.userId.email}
                </p>
                <p className="text-xs text-text-muted">{member.userId.email}</p>
              </div>
              <Badge>{member.roleId.name}</Badge>
            </div>
          ))}
        </div>
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

              return (
                <div key={slot.domain} className="rounded-md border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-text">{slot.title}</p>
                      <p className="text-xs text-text-muted">{slot.description}</p>
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
                          htmlFor="payout-bank-name"
                        >
                          Nom de la banque
                        </label>
                        <Input
                          id="payout-bank-name"
                          className="mt-1 w-full"
                          error={!!paymentErrors.bankName}
                          {...registerPayment("bankName", { required: true })}
                        />
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
                          error={!!paymentErrors.accountNumber}
                          {...registerPayment("accountNumber", { required: true })}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label
                          className="block text-sm font-medium text-text"
                          htmlFor="payout-account-holder"
                        >
                          Titulaire du compte
                        </label>
                        <Input
                          id="payout-account-holder"
                          className="mt-1 w-full"
                          error={!!paymentErrors.accountHolderName}
                          {...registerPayment("accountHolderName", { required: true })}
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
                        Ces informations proviennent de l&apos;inscription WhatsApp Business que
                        vous avez complétée directement chez 360dialog (embedded signup) — elles
                        ne sont pas saisies ici pour la première fois.
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
    </div>
  );
}
