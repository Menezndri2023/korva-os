"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createQuoteSchema, type CreateQuoteInput } from "@korva/validation";
import type { Contact, Quote } from "@korva/types";
import { apiClient, ApiError } from "@/lib/api-client";

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
  const queryClient = useQueryClient();

  const { data: quotes, isLoading } = useQuery({
    queryKey: ["quotes"],
    queryFn: () => apiClient.get<Quote[]>("/quotes"),
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
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
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          {showForm ? "Annuler" : "Nouveau devis"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <select
            className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
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
                <input
                  placeholder="Description"
                  className="col-span-5 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  {...register(`items.${index}.description`)}
                />
                <input
                  type="number"
                  placeholder="Qté"
                  className="col-span-2 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Prix unitaire"
                  className="col-span-2 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  {...register(`items.${index}.unitPrice`, { valueAsNumber: true })}
                />
                <input
                  type="number"
                  placeholder="TVA %"
                  className="col-span-2 rounded-md border border-zinc-300 px-2 py-1.5 text-sm"
                  {...register(`items.${index}.taxRate`, { valueAsNumber: true })}
                />
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="col-span-1 rounded-md text-sm text-red-600 hover:underline"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => append({ description: "", quantity: 1, unitPrice: 0, taxRate: 0 })}
              className="text-sm text-zinc-600 hover:underline"
            >
              + Ajouter une ligne
            </button>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              {createMutation.error instanceof ApiError ? createMutation.error.message : "Erreur"}
            </p>
          )}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {createMutation.isPending ? "Création..." : "Créer le devis"}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">N°</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Total</th>
              <th className="px-4 py-2">Statut</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                  Chargement...
                </td>
              </tr>
            )}
            {!isLoading && quotes?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                  Aucun devis.
                </td>
              </tr>
            )}
            {quotes?.map((quote) => (
              <tr key={quote.id}>
                <td className="px-4 py-2 font-medium">{quote.number}</td>
                <td className="px-4 py-2 text-zinc-600">{contactName(quote.contactId)}</td>
                <td className="px-4 py-2 text-zinc-600">
                  {quote.total} {quote.currency}
                </td>
                <td className="px-4 py-2">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                    {STATUS_LABELS[quote.status]}
                  </span>
                </td>
                <td className="px-4 py-2 space-x-2">
                  {quote.status === "draft" && (
                    <button
                      onClick={() => sendMutation.mutate(quote.id)}
                      className="text-xs text-zinc-600 hover:underline"
                    >
                      Envoyer
                    </button>
                  )}
                  {(quote.status === "sent" || quote.status === "viewed") && (
                    <button
                      onClick={() => acceptMutation.mutate(quote.id)}
                      className="text-xs text-zinc-600 hover:underline"
                    >
                      Accepter
                    </button>
                  )}
                  {quote.status === "accepted" && (
                    <button
                      onClick={() => convertMutation.mutate(quote.id)}
                      className="text-xs text-zinc-600 hover:underline"
                    >
                      Convertir en facture
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
