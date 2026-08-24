"use client";

import Link from "next/link";
import { Fragment, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreatePaymentInput } from "@korva/validation";
import type { Contact, Invoice, Payment } from "@korva/types";
import { Badge, Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const STATUS_LABELS: Record<Invoice["status"], string> = {
  draft: "Brouillon",
  issued: "Émise",
  partially_paid: "Partiellement payée",
  paid: "Payée",
  overdue: "En retard",
  cancelled: "Annulée",
};

export default function InvoicesPage() {
  const queryClient = useQueryClient();
  const [payingInvoiceId, setPayingInvoiceId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const authReady = useAuthReady();

  const { data: invoicesPage, isLoading } = useQuery({
    queryKey: ["invoices", page],
    queryFn: () => apiClient.getList<Invoice>(`/invoices?page=${page}`),
    enabled: authReady,
  });
  const invoices = invoicesPage?.data;
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });

  const issueMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/invoices/${id}/issue`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["invoices"] }),
  });

  const { register, handleSubmit, reset } = useForm<{ amount: number; method?: string }>();
  const payMutation = useMutation({
    mutationFn: (input: CreatePaymentInput) => apiClient.post<Payment>("/payments", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["invoices"] });
      reset();
      setPayingInvoiceId(null);
    },
  });

  function contactName(contactId: string): string {
    const contact = contacts?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company || "—";
  }

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
            <tr>
              <th className="px-4 py-2">N°</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Total</th>
              <th className="px-4 py-2">Payé</th>
              <th className="px-4 py-2">Statut</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                  Chargement...
                </td>
              </tr>
            )}
            {!isLoading && invoices?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                  Aucune facture.
                </td>
              </tr>
            )}
            {invoices?.map((invoice) => (
              <Fragment key={invoice.id}>
                <tr>
                  <td className="px-4 py-2 font-medium">
                    <Link
                      href={`/dashboard/finance/invoices/${invoice.id}`}
                      className="text-text underline-offset-2 hover:underline"
                    >
                      {invoice.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-text-muted">{contactName(invoice.contactId)}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {invoice.total} {invoice.currency}
                  </td>
                  <td className="px-4 py-2 text-text-muted">{invoice.amountPaid}</td>
                  <td className="px-4 py-2">
                    <Badge>{STATUS_LABELS[invoice.status]}</Badge>
                  </td>
                  <td className="px-4 py-2 space-x-2">
                    {invoice.status === "draft" && (
                      <button
                        onClick={() => issueMutation.mutate(invoice.id)}
                        className="text-xs text-text-muted hover:underline"
                      >
                        Émettre
                      </button>
                    )}
                    {(invoice.status === "issued" || invoice.status === "partially_paid") && (
                      <button
                        onClick={() =>
                          setPayingInvoiceId(payingInvoiceId === invoice.id ? null : invoice.id)
                        }
                        className="text-xs text-text-muted hover:underline"
                      >
                        Encaisser
                      </button>
                    )}
                  </td>
                </tr>
                {payingInvoiceId === invoice.id && (
                  <tr>
                    <td colSpan={6} className="bg-surface-muted px-4 py-3">
                      <form
                        onSubmit={handleSubmit((values) =>
                          payMutation.mutate({
                            invoiceId: invoice.id,
                            amount: Number(values.amount),
                            method: values.method,
                          }),
                        )}
                        className="flex items-center gap-2"
                      >
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="Montant"
                          {...register("amount", { required: true, valueAsNumber: true })}
                        />
                        <Input placeholder="Méthode (cash, virement...)" {...register("method")} />
                        <Button type="submit" loading={payMutation.isPending}>
                          {payMutation.isPending ? "..." : "Enregistrer le paiement"}
                        </Button>
                        {payMutation.isError && (
                          <span className="text-xs text-destructive">
                            {payMutation.error instanceof ApiError ? payMutation.error.message : "Erreur"}
                          </span>
                        )}
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>

      <Pagination
        page={page}
        totalPages={invoicesPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
