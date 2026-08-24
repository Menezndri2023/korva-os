"use client";

import Link from "next/link";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createQuoteSchema, type CreateQuoteInput } from "@korva/validation";
import type { Contact, Quote } from "@korva/types";
import { Badge, Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const STATUS_LABELS: Record<Quote["status"], string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  viewed: "Consulté",
  accepted: "Accepté",
  rejected: "Refusé",
  expired: "Expiré",
};

export default function QuotesPage() {
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const { data: quotesPage, isLoading } = useQuery({
    queryKey: ["quotes", page],
    queryFn: () => apiClient.getList<Quote>(`/quotes?page=${page}`),
    enabled: authReady,
  });
  const quotes = quotesPage?.data;
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });

  const { register, control, handleSubmit, reset } = useForm<CreateQuoteInput>({
    resolver: zodResolver(createQuoteSchema),
    defaultValues: {
      currency: "EUR",
      items: [{ description: "", quantity: 1, unitPrice: 0, taxRate: 0 }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const createMutation = useMutation({
    mutationFn: (input: CreateQuoteInput) => apiClient.post<Quote>("/quotes", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["quotes"] });
      reset();
      setShowForm(false);
    },
  });

  const sendMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/quotes/${id}/send`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["quotes"] }),
  });
  const acceptMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/quotes/${id}/accept`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["quotes"] }),
  });
  const convertMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/quotes/${id}/convert-to-invoice`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["invoices"] }),
  });

  function contactName(contactId: string): string {
    const contact = contacts?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company || "—";
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Annuler" : "Nouveau devis"}</Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion documented on the other
          // migrated create-forms (dashboard/crm, dashboard/bookings).
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
        >
          <select
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            defaultValue=""
            {...register("contactId")}
          >
            <option value="" disabled>
              Choisir un client
            </option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email}
              </option>
            ))}
          </select>

          <div className="space-y-2">
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 gap-2">
                <Input
                  placeholder="Description"
                  className="col-span-5"
                  {...register(`items.${index}.description`)}
                />
                <Input
                  type="number"
                  placeholder="Qté"
                  className="col-span-2"
                  {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                />
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Prix unitaire"
                  className="col-span-2"
                  {...register(`items.${index}.unitPrice`, { valueAsNumber: true })}
                />
                <Input
                  type="number"
                  placeholder="TVA %"
                  className="col-span-2"
                  {...register(`items.${index}.taxRate`, { valueAsNumber: true })}
                />
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="col-span-1 rounded-md text-sm text-destructive hover:underline"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => append({ description: "", quantity: 1, unitPrice: 0, taxRate: 0 })}
              className="text-sm text-text-muted hover:underline"
            >
              + Ajouter une ligne
            </button>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof ApiError ? createMutation.error.message : "Erreur"}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? "Création..." : "Créer le devis"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
            <tr>
              <th className="px-4 py-2">N°</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Total</th>
              <th className="px-4 py-2">Statut</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                  Chargement...
                </td>
              </tr>
            )}
            {!isLoading && quotes?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                  Aucun devis.
                </td>
              </tr>
            )}
            {quotes?.map((quote) => (
              <tr key={quote.id}>
                <td className="px-4 py-2 font-medium">
                  <Link
                    href={`/dashboard/finance/${quote.id}`}
                    className="text-text underline-offset-2 hover:underline"
                  >
                    {quote.number}
                  </Link>
                </td>
                <td className="px-4 py-2 text-text-muted">{contactName(quote.contactId)}</td>
                <td className="px-4 py-2 text-text-muted">
                  {quote.total} {quote.currency}
                </td>
                <td className="px-4 py-2">
                  <Badge>{STATUS_LABELS[quote.status]}</Badge>
                </td>
                <td className="px-4 py-2 space-x-2">
                  {quote.status === "draft" && (
                    <button
                      onClick={() => sendMutation.mutate(quote.id)}
                      className="text-xs text-text-muted hover:underline"
                    >
                      Envoyer
                    </button>
                  )}
                  {(quote.status === "sent" || quote.status === "viewed") && (
                    <button
                      onClick={() => acceptMutation.mutate(quote.id)}
                      className="text-xs text-text-muted hover:underline"
                    >
                      Accepter
                    </button>
                  )}
                  {quote.status === "accepted" && (
                    <button
                      onClick={() => convertMutation.mutate(quote.id)}
                      className="text-xs text-text-muted hover:underline"
                    >
                      Convertir en facture
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Pagination
        page={page}
        totalPages={quotesPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
