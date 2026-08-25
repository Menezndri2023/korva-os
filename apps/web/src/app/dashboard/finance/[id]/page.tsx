"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Contact, Quote } from "@korva/types";
import { Badge, Button, Card } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { formatCurrency } from "@/lib/analytics-format";

const STATUS_LABELS: Record<Quote["status"], string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  viewed: "Consulté",
  accepted: "Accepté",
  rejected: "Refusé",
  expired: "Expiré",
};

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const quoteQuery = useQuery({
    queryKey: ["quotes", id],
    queryFn: () => apiClient.get<Quote>(`/quotes/${id}`),
    enabled: authReady,
  });
  const contactsQuery = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["quotes"] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
  };
  const sendMutation = useMutation({
    mutationFn: () => apiClient.post(`/quotes/${id}/send`),
    onSuccess: invalidate,
  });
  const acceptMutation = useMutation({
    mutationFn: () => apiClient.post(`/quotes/${id}/accept`),
    onSuccess: invalidate,
  });
  const rejectMutation = useMutation({
    mutationFn: () => apiClient.post(`/quotes/${id}/reject`),
    onSuccess: invalidate,
  });
  const convertMutation = useMutation({
    mutationFn: () => apiClient.post(`/quotes/${id}/convert-to-invoice`),
    onSuccess: invalidate,
  });

  const actionError = [sendMutation, acceptMutation, rejectMutation, convertMutation]
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

  if (quoteQuery.isLoading) {
    return <p className="text-sm text-text-muted">Chargement...</p>;
  }

  if (quoteQuery.isError || !quoteQuery.data) {
    const error = quoteQuery.error;
    const message =
      error instanceof ApiError ? error.message : "Impossible de charger ce devis.";
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/finance"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          Retour aux devis
        </Link>
      </Card>
    );
  }

  const quote = quoteQuery.data;

  return (
    <div className="space-y-4">
      <Link href="/dashboard/finance" className="text-sm text-text-muted hover:underline">
        ← Devis
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{quote.number}</h1>
            <Link
              href={`/dashboard/crm/${quote.contactId}`}
              className="text-sm text-text-muted underline-offset-2 hover:underline"
            >
              {contactName(quote.contactId)}
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{STATUS_LABELS[quote.status]}</Badge>
            {quote.status === "draft" && (
              <Button
                variant="secondary"
                size="sm"
                loading={sendMutation.isPending}
                onClick={() => sendMutation.mutate()}
              >
                Envoyer
              </Button>
            )}
            {(quote.status === "sent" || quote.status === "viewed") && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={acceptMutation.isPending}
                  onClick={() => acceptMutation.mutate()}
                >
                  Accepter
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={rejectMutation.isPending}
                  onClick={() => rejectMutation.mutate()}
                >
                  Refuser
                </Button>
              </>
            )}
            {quote.status === "accepted" && (
              <Button
                variant="secondary"
                size="sm"
                loading={convertMutation.isPending}
                onClick={() => convertMutation.mutate()}
              >
                Convertir en facture
              </Button>
            )}
          </div>
        </div>

        {actionError instanceof ApiError && (
          <p className="mt-3 text-sm text-destructive">{actionError.message}</p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          <div>
            <dt className="text-text-muted">Créé le</dt>
            <dd className="mt-0.5">{new Date(quote.createdAt).toLocaleString("fr-FR")}</dd>
          </div>
          {quote.validUntil && (
            <div>
              <dt className="text-text-muted">Valide jusqu&apos;au</dt>
              <dd className="mt-0.5">{new Date(quote.validUntil).toLocaleDateString("fr-FR")}</dd>
            </div>
          )}
        </dl>

        {quote.notes && (
          <div className="mt-4">
            <dt className="text-sm text-text-muted">Notes</dt>
            <dd className="mt-0.5 text-sm text-text">{quote.notes}</dd>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
              <tr>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2">Qté</th>
                <th className="px-4 py-2">Prix unitaire</th>
                <th className="px-4 py-2">TVA</th>
                <th className="px-4 py-2">Total ligne</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {quote.items.map((item, index) => (
                <tr key={index}>
                  <td className="px-4 py-2 font-medium">{item.description}</td>
                  <td className="px-4 py-2 text-text-muted">{item.quantity}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {formatCurrency(item.unitPrice, quote.currency)}
                  </td>
                  <td className="px-4 py-2 text-text-muted">{item.taxRate ?? 0}%</td>
                  <td className="px-4 py-2 text-text-muted">
                    {formatCurrency(
                      item.quantity * item.unitPrice * (1 + (item.taxRate ?? 0) / 100),
                      quote.currency,
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-8 border-t border-border px-4 py-3 text-sm">
          <div className="text-right text-text-muted">
            <p>Sous-total</p>
            <p>TVA</p>
            <p className="font-semibold text-text">Total</p>
          </div>
          <div className="text-right">
            <p>{formatCurrency(quote.subtotal, quote.currency)}</p>
            <p>{formatCurrency(quote.taxTotal, quote.currency)}</p>
            <p className="font-semibold">{formatCurrency(quote.total, quote.currency)}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
