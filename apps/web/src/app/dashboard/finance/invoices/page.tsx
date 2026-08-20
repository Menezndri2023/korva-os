"use client";

import { Fragment, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreatePaymentInput } from "@korva/validation";
import type { Contact, Invoice, Payment } from "@korva/types";
import { apiClient, ApiError } from "@/lib/api-client";

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

  const { data: invoices, isLoading } = useQuery({
    queryKey: ["invoices"],
    queryFn: () => apiClient.get<Invoice[]>("/invoices"),
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
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
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-2">N°</th>
            <th className="px-4 py-2">Client</th>
            <th className="px-4 py-2">Total</th>
            <th className="px-4 py-2">Payé</th>
            <th className="px-4 py-2">Statut</th>
            <th className="px-4 py-2">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {isLoading && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                Chargement...
              </td>
            </tr>
          )}
          {!isLoading && invoices?.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                Aucune facture.
              </td>
            </tr>
          )}
          {invoices?.map((invoice) => (
            <Fragment key={invoice.id}>
              <tr>
                <td className="px-4 py-2 font-medium">{invoice.number}</td>
                <td className="px-4 py-2 text-zinc-600">{contactName(invoice.contactId)}</td>
                <td className="px-4 py-2 text-zinc-600">
                  {invoice.total} {invoice.currency}
                </td>
                <td className="px-4 py-2 text-zinc-600">{invoice.amountPaid}</td>
                <td className="px-4 py-2">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                    {STATUS_LABELS[invoice.status]}
                  </span>
                </td>
                <td className="px-4 py-2 space-x-2">
                  {invoice.status === "draft" && (
                    <button
                      onClick={() => issueMutation.mutate(invoice.id)}
                      className="text-xs text-zinc-600 hover:underline"
                    >
                      Émettre
                    </button>
                  )}
                  {(invoice.status === "issued" || invoice.status === "partially_paid") && (
                    <button
                      onClick={() =>
                        setPayingInvoiceId(payingInvoiceId === invoice.id ? null : invoice.id)
                      }
                      className="text-xs text-zinc-600 hover:underline"
                    >
                      Encaisser
                    </button>
                  )}
                </td>
              </tr>
              {payingInvoiceId === invoice.id && (
                <tr>
                  <td colSpan={6} className="bg-zinc-50 px-4 py-3">
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
                      <input
                        type="number"
                        step="0.01"
                        placeholder="Montant"
                        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                        {...register("amount", { required: true, valueAsNumber: true })}
                      />
                      <input
                        placeholder="Méthode (cash, virement...)"
                        className="rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                        {...register("method")}
                      />
                      <button
                        type="submit"
                        disabled={payMutation.isPending}
                        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                      >
                        {payMutation.isPending ? "..." : "Enregistrer le paiement"}
                      </button>
                      {payMutation.isError && (
                        <span className="text-xs text-red-600">
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
    </div>
  );
}
