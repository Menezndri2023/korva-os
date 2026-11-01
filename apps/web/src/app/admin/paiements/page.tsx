"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge, Card, EmptyState, Notice, PageHeader, SkeletonList, Table, Td, Th } from "@korva/ui";
import { adminApi, formatDay, type PlatformPaymentAccounts } from "@/lib/platform-admin";

const ROLE_LABELS: Record<string, string> = {
  "merchant-of-record": "Ventes des entreprises (Solde KORVA)",
  "subscription-billing": "Formules KORVA",
};

const STATUS: Record<string, { label: string; variant: "success" | "warning" | "default" }> = {
  active: { label: "Actif", variant: "success" },
  pending: { label: "En attente", variant: "warning" },
  error: { label: "En erreur", variant: "warning" },
  revoked: { label: "Révoqué", variant: "default" },
};

const HOUR_MS = 60 * 60 * 1000;

/**
 * KORVA's own payment accounts, read-only: which are active, when GeniusPay last answered, and
 * whether its webhooks still arrive. Secrets never leave the server — they are set on it with
 * ops/set-secret.sh, never typed here.
 */
export default function AdminPaymentsPage() {
  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ["platform", "payment-accounts"],
    queryFn: () => adminApi.get<PlatformPaymentAccounts>("/platform/payment-accounts"),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paiements GeniusPay"
        description="Les comptes de paiement de KORVA et la santé de leurs notifications. Les clés secrètes se règlent sur le serveur, jamais ici."
      />

      {isLoading && <SkeletonList rows={3} />}
      {isError && <p className="text-sm text-destructive">Impossible de charger les comptes de paiement.</p>}

      {data && (
        <>
          <Notice tone={data.payoutApproval === "manual" ? "info" : "warning"}>
            {data.payoutApproval === "manual"
              ? "Reversements en validation manuelle : chaque retrait attend votre accord dans Reversements. À garder tant que GeniusPay n'a pas confirmé par écrit les paiements vers des numéros tiers."
              : "Reversements automatiques : les retraits partent sans votre validation."}
          </Notice>

          <Card className="overflow-hidden">
            {data.accounts.length === 0 ? (
              <EmptyState
                title="Aucun compte de paiement."
                description="Sans compte GeniusPay actif, ni les formules ni les ventes en ligne ne peuvent être payées."
              />
            ) : (
              <Table caption="Comptes de paiement de KORVA">
                <thead>
                  <tr>
                    <Th>Compte</Th>
                    <Th>État</Th>
                    <Th>Dernière vérification</Th>
                    <Th>Dernière notification reçue</Th>
                    <Th align="right">Notifications 24 h</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((account) => {
                    const status = STATUS[account.status] ?? { label: account.status, variant: "default" as const };
                    const silent =
                      account.status === "active" &&
                      (!account.lastWebhookAt || dataUpdatedAt - new Date(account.lastWebhookAt).getTime() > 24 * HOUR_MS);
                    return (
                      <tr key={account.id}>
                        <Td>
                          <span className="font-medium capitalize">{account.provider}</span>
                          <span className="block text-xs text-text-muted">
                            {ROLE_LABELS[account.role] ?? account.role}
                            {account.market ? `, ${account.market}` : ", tous pays"}
                          </span>
                        </Td>
                        <Td>
                          <Badge variant={status.variant}>{status.label}</Badge>
                          {account.lastErrorMessage && (
                            <span className="mt-1 block max-w-xs text-xs text-destructive">
                              {account.lastErrorMessage} ({formatDay(account.lastErrorAt)})
                            </span>
                          )}
                        </Td>
                        <Td>{account.lastVerifiedAt ? formatDay(account.lastVerifiedAt) : "Jamais"}</Td>
                        <Td>
                          {account.lastWebhookAt ? formatDay(account.lastWebhookAt) : "Aucune"}
                          {silent && (
                            <span className="mt-1 block text-xs text-warning">
                              Rien depuis 24 h : vérifiez l&apos;adresse de notification dans GeniusPay.
                            </span>
                          )}
                        </Td>
                        <Td numeric>{account.webhooksLast24h}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
          <p className="text-sm text-text-muted">
            Sans notification, un paiement est quand même confirmé par la vérification automatique, quelques minutes plus tard.
          </p>
        </>
      )}
    </div>
  );
}
