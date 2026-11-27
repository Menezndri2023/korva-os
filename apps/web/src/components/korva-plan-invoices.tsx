"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SubscriptionInvoice, WalletSummary } from "@korva/types";
import { Badge, Button, Notice } from "@korva/ui";
import { DownloadButton } from "@/components/download-button";
import { apiClient, ApiError } from "@/lib/api-client";
import { formatCurrency } from "@/lib/analytics-format";
import { useAuthReady } from "@/lib/use-auth-ready";
import { intlLocale, useDashboardLocale, useT, type Translate } from "@/lib/dashboard-locale";

const STATUS: Record<string, { label: [string, string]; variant: "default" | "success" | "warning" }> = {
  open: { label: ["À payer", "To pay"], variant: "warning" },
  paid: { label: ["Payée", "Paid"], variant: "success" },
  void: { label: ["Annulée", "Cancelled"], variant: "default" },
};

const ERRORS: Record<string, [string, string]> = {
  WALLET_INSUFFICIENT_BALANCE: [
    "Votre solde disponible ne couvre pas cette facture.",
    "Your available balance does not cover this invoice.",
  ],
  WALLET_CURRENCY_MISMATCH: [
    "Cette facture n'est pas dans la devise de votre solde.",
    "This invoice is not in your balance's currency.",
  ],
  SUBSCRIPTION_INVOICE_NOT_PAYABLE: ["Cette facture est déjà réglée.", "This invoice is already paid."],
  PAYMENT_PROVIDER_NOT_CONFIGURED: [
    "Le paiement en ligne de la formule n'est pas encore disponible. Contactez KORVA.",
    "Paying the plan online is not available yet. Contact KORVA.",
  ],
};

function errorText(error: unknown, t: Translate): string {
  const known = error instanceof ApiError ? ERRORS[error.code] : undefined;
  return known ? t(...known) : t("Le paiement n'a pas abouti. Réessayez.", "The payment did not go through. Try again.");
}

/**
 * KORVA's own invoices for the business's plan, with the two ways to pay one: GeniusPay's hosted
 * page (mobile money or card), or the Solde KORVA. Coming back from GeniusPay
 * (?subscriptionInvoice=ABO-…), the invoice is checked with GeniusPay — never assumed paid.
 */
export function KorvaPlanInvoices() {
  const authReady = useAuthReady();
  const queryClient = useQueryClient();
  const locale = useDashboardLocale();
  const t = useT();
  const intl = intlLocale(locale);
  const invoices = useQuery({
    queryKey: ["subscriptions", "invoices"],
    queryFn: () => apiClient.get<SubscriptionInvoice[]>("/subscriptions/invoices"),
    enabled: authReady,
  });
  const wallet = useQuery({
    queryKey: ["wallet"],
    queryFn: () => apiClient.get<WalletSummary>("/wallet"),
    enabled: authReady,
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["subscriptions"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet"] });
  };

  const checkout = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ checkoutUrl: string }>(`/subscriptions/invoices/${id}/checkout`),
    onSuccess: ({ checkoutUrl }) => window.location.assign(checkoutUrl),
  });
  const fromWallet = useMutation({
    mutationFn: (id: string) => apiClient.post(`/subscriptions/invoices/${id}/pay-from-wallet`),
    onSuccess: refresh,
  });
  const cancelChange = useMutation({
    mutationFn: () => apiClient.post("/subscriptions/plan-change/cancel"),
    onSuccess: refresh,
  });
  const verify = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<{ invoiceNumber: string; status: string }>(`/subscriptions/invoices/${id}/verify`),
    onSuccess: refresh,
  });

  // Back from GeniusPay: check that invoice once.
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current || !invoices.data) return;
    const number = new URLSearchParams(window.location.search).get("subscriptionInvoice");
    const returned = number && invoices.data.find((invoice) => invoice.number === number);
    if (returned && returned.status === "open") {
      checked.current = true;
      verify.mutate(returned.id);
    }
  }, [invoices.data, verify]);

  if (!invoices.data || invoices.data.length === 0) return null;
  const available = wallet.data?.available ?? 0;
  const busy = checkout.isPending || fromWallet.isPending;

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-text">{t("Factures KORVA", "KORVA invoices")}</h3>
      {verify.data && (
        <Notice tone={verify.data.status === "paid" ? "accent" : "warning"}>
          {verify.data.status === "paid"
            ? t(`Facture ${verify.data.invoiceNumber} payée. Merci !`, `Invoice ${verify.data.invoiceNumber} paid. Thank you!`)
            : t(
                `Le paiement de la facture ${verify.data.invoiceNumber} n'est pas encore confirmé par GeniusPay. Revenez dans quelques minutes.`,
                `GeniusPay has not confirmed the payment of invoice ${verify.data.invoiceNumber} yet. Come back in a few minutes.`,
              )}
        </Notice>
      )}
      {(checkout.isError || fromWallet.isError) && (
        <p className="text-sm text-destructive" role="alert">
          {errorText(checkout.error ?? fromWallet.error, t)}
        </p>
      )}
      <ul className="divide-y divide-border">
        {invoices.data.map((invoice) => {
          const status = STATUS[invoice.status] ?? {
            label: [invoice.status, invoice.status] as [string, string],
            variant: "default" as const,
          };
          const coveredByWallet =
            wallet.data?.currency === invoice.currency && available >= invoice.amount;
          return (
            <li key={invoice.id} className="space-y-2 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {invoice.kind === "plan_change" && (
                    <span className="block text-xs font-medium text-text">
                      {t("Changement de formule — activé dès le paiement", "Plan change — starts as soon as it is paid")}
                    </span>
                  )}
                  <span className="font-medium">{invoice.number}</span>{" "}
                  <span className="tabular-nums">{formatCurrency(invoice.amount, invoice.currency, locale)}</span>
                  <span className="block text-xs text-text-muted">
                    {t(
                      `Du ${new Date(invoice.periodStart).toLocaleDateString(intl)} au ${new Date(invoice.periodEnd).toLocaleDateString(intl)}`,
                      `From ${new Date(invoice.periodStart).toLocaleDateString(intl)} to ${new Date(invoice.periodEnd).toLocaleDateString(intl)}`,
                    )}
                    {invoice.status === "open" &&
                      invoice.kind !== "plan_change" &&
                      t(
                        ` — à régler avant le ${new Date(invoice.dueAt).toLocaleDateString(intl)}`,
                        ` — due by ${new Date(invoice.dueAt).toLocaleDateString(intl)}`,
                      )}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {invoice.status !== "void" && (
                    <DownloadButton
                      path={`/subscriptions/invoices/${invoice.id}/pdf`}
                      filename={`KORVA-${invoice.number}.pdf`}
                      label={t("Facture PDF", "PDF invoice")}
                    />
                  )}
                  <Badge variant={status.variant}>{t(...status.label)}</Badge>
                </span>
              </div>
              {invoice.status === "open" && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" loading={checkout.isPending} disabled={busy} onClick={() => checkout.mutate(invoice.id)}>
                    {t("Payer par mobile money ou carte", "Pay by mobile money or card")}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={fromWallet.isPending}
                    disabled={busy || !coveredByWallet}
                    title={
                      coveredByWallet
                        ? undefined
                        : t("Votre solde disponible ne couvre pas cette facture", "Your available balance does not cover this invoice")
                    }
                    onClick={() => fromWallet.mutate(invoice.id)}
                  >
                    {t("Payer avec mon Solde", "Pay from my balance")} (
                    {formatCurrency(available, wallet.data?.currency ?? invoice.currency, locale)})
                  </Button>
                  {invoice.kind === "plan_change" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={cancelChange.isPending}
                      disabled={busy}
                      onClick={() => cancelChange.mutate()}
                    >
                      {t("Annuler ce changement", "Cancel this change")}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
