"use client";

import { DownloadButton } from "@/components/download-button";
import { giftCardErrorText } from "@/lib/gift-card-errors";
import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreatePaymentInput } from "@korva/validation";
import type { Contact, Invoice, Payment } from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { formatCurrency } from "@/lib/analytics-format";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

interface MemberOption {
  id: string;
  userId: { firstName?: string; lastName?: string; email: string };
}

function memberName(member: MemberOption): string {
  return (
    [member.userId.firstName, member.userId.lastName].filter(Boolean).join(" ") ||
    member.userId.email
  );
}

const STATUS_LABELS: Record<Invoice["status"], [string, string]> = {
  draft: ["Brouillon", "Draft"],
  issued: ["Émise", "Issued"],
  partially_paid: ["Partiellement payée", "Partly paid"],
  paid: ["Payée", "Paid"],
  overdue: ["En retard", "Overdue"],
  cancelled: ["Annulée", "Cancelled"],
};

export default function InvoiceDetailPage() {
  const locale = useDashboardLocale();
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const invoiceQuery = useQuery({
    queryKey: ["invoices", id],
    queryFn: () => apiClient.get<Invoice>(`/invoices/${id}`),
    enabled: authReady,
  });
  const contactsQuery = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const paymentsQuery = useQuery({
    queryKey: ["payments", "invoice", id],
    queryFn: () => apiClient.get<Payment[]>(`/payments?invoiceId=${id}`),
    enabled: authReady,
  });
  const { data: members } = useQuery({
    queryKey: ["organizations", "me", "members"],
    queryFn: () => apiClient.get<MemberOption[]>("/organizations/me/members"),
    enabled: authReady,
  });
  function staffName(membershipId?: string): string {
    const member = members?.find((m) => m.id === membershipId);
    return member ? memberName(member) : "—";
  }

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
    void queryClient.invalidateQueries({ queryKey: ["payments", "invoice", id] });
  };
  const issueMutation = useMutation({
    mutationFn: () => apiClient.post(`/invoices/${id}/issue`),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: () => apiClient.post(`/invoices/${id}/cancel`),
    onSuccess: invalidate,
  });

  const { register, handleSubmit, reset } = useForm<{
    amount: number;
    method?: string;
    tipAmount?: number;
    tipStaffMembershipId?: string;
  }>();
  const payMutation = useMutation({
    mutationFn: (input: CreatePaymentInput) => apiClient.post<Payment>("/payments", input),
    onSuccess: () => {
      invalidate();
      reset();
    },
  });

  const actionError = [issueMutation, cancelMutation, payMutation]
    .map((mutation) => mutation.error)
    .find((error) => error instanceof ApiError);

  function contactName(contactId: string): string {
    const contact = contactsQuery.data?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return (
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.company ||
      "—"
    );
  }

  if (invoiceQuery.isLoading) {
    return <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>;
  }

  if (invoiceQuery.isError || !invoiceQuery.data) {
    const error = invoiceQuery.error;
    const message =
      error instanceof ApiError ? error.message : t(
        "Impossible de charger cette facture.",
        "This invoice could not be loaded.",
      );
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/finance/invoices"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          {t("Retour aux factures", "Back to invoices")}
        </Link>
      </Card>
    );
  }

  const invoice = invoiceQuery.data;
  const remaining = invoice.total - invoice.amountPaid;

  return (
    <div className="space-y-4">
      <Link
        href="/dashboard/finance/invoices"
        className="text-sm text-text-muted hover:underline"
      >
        {t("← Factures", "← Invoices")}
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{invoice.number}</h1>
            <Link
              href={`/dashboard/crm/${invoice.contactId}`}
              className="text-sm text-text-muted underline-offset-2 hover:underline"
            >
              {contactName(invoice.contactId)}
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{t(...STATUS_LABELS[invoice.status])}</Badge>
            <DownloadButton
              path={`/invoices/${invoice.id}/pdf`}
              filename={`${invoice.number}.pdf`}
              label={t("Télécharger le PDF", "Download the PDF")}
            />
            {invoice.status === "draft" && (
              <Button
                variant="secondary"
                size="sm"
                loading={issueMutation.isPending}
                onClick={() => issueMutation.mutate()}
              >
                {t("Émettre", "Issue")}
              </Button>
            )}
            {invoice.status !== "paid" && invoice.status !== "cancelled" && (
              <Button
                variant="ghost"
                size="sm"
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                {t("Annuler", "Cancel")}
              </Button>
            )}
          </div>
        </div>

        {actionError instanceof ApiError && (
          <p className="mt-3 text-sm text-destructive">{actionError.message}</p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <dt className="text-text-muted">{t("Créée le", "Created")}</dt>
            <dd className="mt-0.5">{new Date(invoice.createdAt).toLocaleString(intlLocale(locale))}</dd>
          </div>
          {invoice.dueDate && (
            <div>
              <dt className="text-text-muted">{t("Échéance", "Due date")}</dt>
              <dd className="mt-0.5">{new Date(invoice.dueDate).toLocaleDateString(intlLocale(locale))}</dd>
            </div>
          )}
          {invoice.reminderSentAt && (
            <div>
              <dt className="text-text-muted">{t("Relance envoyée", "Reminder sent")}</dt>
              <dd className="mt-0.5">
                {t(
                  `${new Date(invoice.reminderSentAt).toLocaleDateString(intlLocale(locale))} par ${invoice.reminderChannel === "whatsapp" ? "WhatsApp" : "e-mail"}`,
                  `${new Date(invoice.reminderSentAt).toLocaleDateString(intlLocale(locale))} by ${invoice.reminderChannel === "whatsapp" ? "WhatsApp" : "e-mail"}`,
                )}
              </dd>
            </div>
          )}
          {invoice.quoteId && (
            <div>
              <dt className="text-text-muted">{t("Devis d'origine", "Original quote")}</dt>
              <dd className="mt-0.5">
                <Link
                  href={`/dashboard/finance/${invoice.quoteId}`}
                  className="text-text underline-offset-2 hover:underline"
                >
                  {t("Voir le devis", "See the quote")}
                </Link>
              </dd>
            </div>
          )}
          <div>
            <dt className="text-text-muted">{t("Restant dû", "Balance due")}</dt>
            <dd className="mt-0.5">{formatCurrency(remaining, invoice.currency, locale)}</dd>
          </div>
        </dl>

        {invoice.notes && (
          <div className="mt-4">
            <dt className="text-sm text-text-muted">{t("Notes", "Notes")}</dt>
            <dd className="mt-0.5 text-sm text-text">{invoice.notes}</dd>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">{t("Description", "Description")}</th>
                <th className="px-4 py-2">{t("Qté", "Qty")}</th>
                <th className="px-4 py-2">{t("Prix unitaire", "Unit price")}</th>
                <th className="px-4 py-2">{t("TVA", "VAT")}</th>
                <th className="px-4 py-2">{t("Total ligne", "Line total")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoice.items.map((item, index) => (
                <tr key={index}>
                  <td className="px-4 py-2 font-medium">{item.description}</td>
                  <td className="px-4 py-2 text-text-muted">{item.quantity}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {formatCurrency(item.unitPrice, invoice.currency, locale)}
                  </td>
                  <td className="px-4 py-2 text-text-muted">{item.taxRate ?? 0}%</td>
                  <td className="px-4 py-2 text-text-muted">
                    {formatCurrency(
                      item.quantity * item.unitPrice * (1 + (item.taxRate ?? 0) / 100),
                      invoice.currency,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-8 border-t border-border px-4 py-3 text-sm">
          <div className="text-right text-text-muted">
            <p>{t("Sous-total", "Subtotal")}</p>
            <p>{t("TVA", "VAT")}</p>
            <p className="text-text">{t("Payé", "Paid")}</p>
            <p className="font-semibold text-text">{t("Total", "Total")}</p>
          </div>
          <div className="text-right">
            <p>{formatCurrency(invoice.subtotal, invoice.currency, locale)}</p>
            <p>{formatCurrency(invoice.taxTotal, invoice.currency, locale)}</p>
            <p>{formatCurrency(invoice.amountPaid, invoice.currency, locale)}</p>
            <p className="font-semibold">{formatCurrency(invoice.total, invoice.currency, locale)}</p>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-semibold text-text">{t("Paiements", "Payments")}</h2>
        <div className="mt-3">
          {paymentsQuery.isLoading && <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>}
          {paymentsQuery.isError && (
            <p className="text-sm text-text-muted">
              {paymentsQuery.error instanceof ApiError
                ? paymentsQuery.error.message
                : t("Non disponible.", "Not available.")}
            </p>
          )}
          {!paymentsQuery.isLoading &&
            !paymentsQuery.isError &&
            (paymentsQuery.data?.length ?? 0) === 0 && (
              <p className="text-sm text-text-muted">{t("Aucun paiement enregistré.", "No payments recorded.")}</p>
            )}
          {!paymentsQuery.isLoading && paymentsQuery.data && paymentsQuery.data.length > 0 && (
            <ul className="divide-y divide-border">
              {paymentsQuery.data.map((payment) => (
                <li key={payment.id} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {formatCurrency(payment.amount, payment.currency, locale)}
                    {payment.method ? ` — ${payment.method}` : ""}
                    {payment.tipAmount
                      ? ` (+ ${formatCurrency(payment.tipAmount, payment.currency, locale)} pourboire${
                          payment.tipStaffMembershipId
                            ? ` pour ${staffName(payment.tipStaffMembershipId)}`
                            : ""
                        })`
                      : ""}
                  </span>
                  <span className="flex items-center gap-3 text-text-muted">
                    {new Date(payment.createdAt).toLocaleString(intlLocale(locale))}
                    {(payment.status === "completed" || payment.status === "refunded") &&
                      payment.amount - (payment.refundedAmount ?? 0) > 0 && (
                        <RefundButton payment={payment} onDone={() => void queryClient.invalidateQueries()} />
                      )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(invoice.status === "issued" || invoice.status === "partially_paid") && (
          <GiftCardPayment invoiceId={invoice.id} onPaid={() => void queryClient.invalidateQueries()} />
        )}

        {(invoice.status === "issued" || invoice.status === "partially_paid") && (
          <form
            onSubmit={handleSubmit((values) =>
              payMutation.mutate({
                invoiceId: invoice.id,
                amount: Number(values.amount),
                method: values.method,
                tipAmount: values.tipAmount ? Number(values.tipAmount) : undefined,
                tipStaffMembershipId: values.tipStaffMembershipId || undefined,
              }),
            )}
            className="mt-4 flex flex-col gap-2 border-t border-border pt-4"
          >
            <p className="text-xs text-text-muted">
              {t(
                "Ceci enregistre un paiement déjà reçu (espèces, virement...) — ce n'est pas un encaissement en ligne.",
                "This records a payment you already received (cash, transfer...) — it is not an online payment.",
              )}
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.01"
                placeholder={t("Montant", "Amount")}
                {...register("amount", { required: true, valueAsNumber: true })}
              />
              <Input placeholder={t(
                "Méthode (cash, virement...)",
                "Method (cash, transfer...)",
              )} {...register("method")} />
              <Input
                type="number"
                step="0.01"
                placeholder={t("Pourboire (optionnel)", "Tip (optional)")}
                {...register("tipAmount", { valueAsNumber: true })}
              />
              <select
                className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
                defaultValue=""
                {...register("tipStaffMembershipId")}
              >
                <option value="">{t("Pourboire pour (optionnel)", "Tip for (optional)")}</option>
                {members?.map((member) => (
                  <option key={member.id} value={member.id}>
                    {memberName(member)}
                  </option>
                ))}
              </select>
              <Button type="submit" loading={payMutation.isPending}>
                {payMutation.isPending ? "..." : t("Enregistrer le paiement", "Record the payment")}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

/**
 * "Rembourser": a payment taken in cash or by hand is refunded at once; one paid online through
 * KORVA (GeniusPay has no refund API) is taken off the Solde and sent back to the customer by
 * KORVA, which then records the transfer's reference.
 */
function RefundButton({ payment, onDone }: { payment: Payment; onDone: () => void }) {
  const t = useT();
  const locale = useDashboardLocale();
  const refundable = Math.round((payment.amount - (payment.refundedAmount ?? 0)) * 100) / 100;
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(refundable));
  const [reason, setReason] = useState("");
  const [key] = useState(() => `refund:${payment.id}:${Date.now()}`);
  const refund = useMutation({
    mutationFn: () =>
      apiClient.post(
        "/payments/refunds",
        { paymentId: payment.id, amount: Number(amount), reason: reason.trim() || undefined },
        { headers: { "Idempotency-Key": key } },
      ),
    onSuccess: () => {
      setOpen(false);
      onDone();
    },
  });
  if (!open) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
        {t("Rembourser", "Refund")}
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        refund.mutate();
      }}
    >
      <Input
        type="number"
        min={0}
        max={refundable}
        step="any"
        aria-label={t("Montant à rembourser", "Amount to refund")}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        className="w-28"
      />
      <Input
        aria-label={t("Motif du remboursement", "Refund reason")}
        placeholder={t("Motif (optionnel)", "Reason (optional)")}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="w-40"
      />
      <Button type="submit" size="sm" loading={refund.isPending} disabled={!(Number(amount) > 0 && Number(amount) <= refundable)}>
        {t(`Rembourser ${formatCurrency(Number(amount) || 0, payment.currency, locale)}`, `Refund ${formatCurrency(Number(amount) || 0, payment.currency, locale)}`)}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
        {t("Annuler", "Cancel")}
      </Button>
      {payment.provider === "geniuspay" && (
        <p className="w-full text-xs text-text-muted">
          {t(
            "Paiement en ligne : le montant est retiré de votre Solde KORVA, et KORVA le renvoie au client.",
            "Online payment: the amount is taken from your KORVA balance, and KORVA sends it back to the customer.",
          )}
        </p>
      )}
      {refund.isError && (
        <p className="w-full text-xs text-destructive">
          {refund.error instanceof ApiError ? refund.error.message : t("Le remboursement n'a pas abouti.", "The refund did not go through.")}
        </p>
      )}
    </form>
  );
}

/** "Payer avec une carte cadeau": the card pays what it can of what is left on the invoice. */
function GiftCardPayment({ invoiceId, onPaid }: { invoiceId: string; onPaid: () => void }) {
  const t = useT();
  const locale = useDashboardLocale();
  const [code, setCode] = useState("");
  const [open, setOpen] = useState(false);
  const pay = useMutation({
    mutationFn: () => apiClient.post<{ amount: number; balance: number }>("/gift-cards/pay", { code: code.trim(), invoiceId }),
    onSuccess: () => {
      setCode("");
      onPaid();
    },
  });
  if (!open) {
    return (
      <div className="mt-4">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(true)}>
          {t("Payer avec une carte cadeau", "Pay with a gift card")}
        </Button>
      </div>
    );
  }
  return (
    <form
      className="mt-4 flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        pay.mutate();
      }}
    >
      <Input
        aria-label={t("Code de la carte cadeau", "Gift card code")}
        placeholder="KDO-XXXX-XXXX"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        className="w-48 font-mono"
      />
      <Button type="submit" size="sm" loading={pay.isPending} disabled={code.trim().length < 4}>
        {t("Utiliser la carte", "Use the card")}
      </Button>
      {pay.isSuccess && (
        <p className="w-full text-xs text-text-muted" role="status">
          {t(
            `${pay.data.amount.toLocaleString(intlLocale(locale))} payés avec la carte, il reste ${pay.data.balance.toLocaleString(intlLocale(locale))} dessus.`,
            `${pay.data.amount.toLocaleString(intlLocale(locale))} paid with the card, ${pay.data.balance.toLocaleString(intlLocale(locale))} left on it.`,
          )}
        </p>
      )}
      {pay.isError && (
        <p className="w-full text-xs text-destructive">
          {(() => {
            const known = giftCardErrorText(pay.error);
            return known ? t(...known) : t("La carte n'a pas pu être utilisée.", "The card could not be used.");
          })()}
        </p>
      )}
    </form>
  );
}
