"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomerAccountSummary } from "@korva/types";
import { Badge, Button, Card } from "@korva/ui";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";
import type { Locale } from "@korva/types";

export function formatSeen(iso: string | undefined, locale: Locale): string {
  if (iso) return new Date(iso).toLocaleString(intlLocale(locale), { dateStyle: "short", timeStyle: "short" });
  return locale === "en" ? "Never" : "Jamais";
}

export function AccountStatus({ account }: { account: CustomerAccountSummary }) {
  const t = useT();
  return account.disabledAt ? (
    <Badge variant="warning">{t("Suspendu", "Suspended")}</Badge>
  ) : (
    <Badge variant="success">{t("Actif", "Active")}</Badge>
  );
}

/**
 * What a business can do about one of its customers' accounts: suspend it (sign-in refused,
 * open sessions ended — nothing deleted), restore it, or send the customer a new-password link.
 * Suspending asks for confirmation in the page itself.
 */
export function CustomerAccountActions({ account }: { account: CustomerAccountSummary }) {
  const queryClient = useQueryClient();
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [sent, setSent] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["customer-accounts"] });

  const toggle = useMutation({
    mutationFn: () =>
      apiClient.post<CustomerAccountSummary>(
        `/customer-accounts/${account.id}/${account.disabledAt ? "enable" : "disable"}`,
      ),
    onSuccess: async () => {
      setConfirming(false);
      await refresh();
    },
  });
  const reset = useMutation({
    mutationFn: () => apiClient.post(`/customer-accounts/${account.id}/password-reset`),
    onSuccess: () => setSent(true),
  });
  const error = toggle.error ?? reset.error;

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap gap-2">
        {account.disabledAt ? (
          <Button size="sm" variant="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
            {t("Rétablir l'accès", "Restore access")}
          </Button>
        ) : confirming ? (
          <>
            <Button size="sm" variant="danger" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              {t("Confirmer la suspension", "Confirm the suspension")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              {t("Annuler", "Cancel")}
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
            {t("Suspendre", "Suspend")}
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={reset.isPending || sent} onClick={() => reset.mutate()}>
          {sent ? t("Lien envoyé", "Link sent") : t("Envoyer un lien de mot de passe", "Send a password link")}
        </Button>
      </div>
      {confirming && (
        <p className="text-xs text-text-muted">
          {t(
            "Le client ne pourra plus se connecter à votre site. Ses commandes et réservations sont conservées.",
            "The customer will no longer be able to sign in to your website. Their orders and bookings are kept.",
          )}
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive">
          {error instanceof ApiError ? error.message : t("L'action n'a pas abouti. Réessayez.", "That did not work. Try again.")}
        </p>
      )}
    </div>
  );
}

/** On a customer's page: whether they have an account on the site, and its actions. */
export function ContactAccountCard({ contactId }: { contactId: string }) {
  const authReady = useAuthReady();
  const locale = useDashboardLocale();
  const t = useT();
  const { data, isLoading } = useQuery({
    queryKey: ["customer-accounts", "contact", contactId],
    queryFn: () => apiClient.get<CustomerAccountSummary | null>(`/customer-accounts/contact/${contactId}`),
    enabled: authReady,
  });
  if (isLoading) return null;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text">{t("Espace client", "Customer area")}</h2>
        {data && <AccountStatus account={data} />}
      </div>
      {data ? (
        <div className="mt-2 space-y-3 text-sm">
          <p className="text-text-muted">
            {t(
              `Compte ${data.email}, créé le ${new Date(data.createdAt).toLocaleDateString("fr-FR")}. Dernière connexion : ${formatSeen(data.lastLoginAt, locale)}.`,
              `Account ${data.email}, created ${new Date(data.createdAt).toLocaleDateString(intlLocale(locale))}. Last sign-in: ${formatSeen(data.lastLoginAt, locale)}.`,
            )}
          </p>
          <CustomerAccountActions account={data} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-text-muted">
          {t(
            "Ce client n'a pas de compte sur votre site. Il peut en créer un avec le lien « Se connecter ».",
            "This customer has no account on your website. They can create one with the “Sign in” link.",
          )}
        </p>
      )}
    </Card>
  );
}
