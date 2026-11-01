"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CustomerAccountSummary } from "@korva/types";
import { Badge, Button, Card } from "@korva/ui";
import { ApiError, apiClient } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

export function formatSeen(iso?: string): string {
  return iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "Jamais";
}

export function AccountStatus({ account }: { account: CustomerAccountSummary }) {
  return account.disabledAt ? <Badge variant="warning">Suspendu</Badge> : <Badge variant="success">Actif</Badge>;
}

/**
 * What a business can do about one of its customers' accounts: suspend it (sign-in refused,
 * open sessions ended — nothing deleted), restore it, or send the customer a new-password link.
 * Suspending asks for confirmation in the page itself.
 */
export function CustomerAccountActions({ account }: { account: CustomerAccountSummary }) {
  const queryClient = useQueryClient();
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
            Rétablir l&apos;accès
          </Button>
        ) : confirming ? (
          <>
            <Button size="sm" variant="danger" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
              Confirmer la suspension
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Annuler
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => setConfirming(true)}>
            Suspendre
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={reset.isPending || sent} onClick={() => reset.mutate()}>
          {sent ? "Lien envoyé" : "Envoyer un lien de mot de passe"}
        </Button>
      </div>
      {confirming && (
        <p className="text-xs text-text-muted">
          Le client ne pourra plus se connecter à votre site. Ses commandes et réservations sont conservées.
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive">
          {error instanceof ApiError ? error.message : "L'action n'a pas abouti. Réessayez."}
        </p>
      )}
    </div>
  );
}

/** On a customer's page: whether they have an account on the site, and its actions. */
export function ContactAccountCard({ contactId }: { contactId: string }) {
  const authReady = useAuthReady();
  const { data, isLoading } = useQuery({
    queryKey: ["customer-accounts", "contact", contactId],
    queryFn: () => apiClient.get<CustomerAccountSummary | null>(`/customer-accounts/contact/${contactId}`),
    enabled: authReady,
  });
  if (isLoading) return null;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text">Espace client</h2>
        {data && <AccountStatus account={data} />}
      </div>
      {data ? (
        <div className="mt-2 space-y-3 text-sm">
          <p className="text-text-muted">
            Compte {data.email}, créé le {new Date(data.createdAt).toLocaleDateString("fr-FR")}. Dernière
            connexion : {formatSeen(data.lastLoginAt)}.
          </p>
          <CustomerAccountActions account={data} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-text-muted">
          Ce client n&apos;a pas de compte sur votre site. Il peut en créer un avec le lien « Se connecter ».
        </p>
      )}
    </Card>
  );
}
