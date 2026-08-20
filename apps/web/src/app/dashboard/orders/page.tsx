"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOrderSchema, type CreateOrderInput } from "@korva/validation";
import type { Contact, Order } from "@korva/types";
import { apiClient, ApiError } from "@/lib/api-client";

const STATUS_LABELS: Record<Order["status"], string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  fulfilled: "Livrée",
  cancelled: "Annulée",
};

export default function OrdersPage() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data: orders, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.get<Order[]>("/orders"),
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
  });

  const { register, control, handleSubmit, reset } = useForm<CreateOrderInput>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: {
      currency: "EUR",
      items: [{ description: "", quantity: 1, unitPrice: 0, taxRate: 0 }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
  };

  const createMutation = useMutation({
    mutationFn: (input: CreateOrderInput) => apiClient.post<Order>("/orders", input),
    onSuccess: () => {
      invalidate();
      reset();
      setShowForm(false);
    },
  });
  const confirmMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/orders/${id}/confirm`),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/orders/${id}/cancel`),
    onSuccess: invalidate,
  });
  const fulfillMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/orders/${id}/fulfill`),
    onSuccess: invalidate,
  });
  const invoiceMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/orders/${id}/generate-invoice`),
    onSuccess: invalidate,
  });

  function contactName(contactId: string): string {
    const contact = contacts?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company || "—";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Commandes</h1>
        <p className="mt-1 text-sm text-zinc-500">Commandes manuelles, issues du panier ou d&apos;une réservation.</p>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          {showForm ? "Annuler" : "Nouvelle commande"}
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
                  className="col-span-1 text-sm text-red-600 hover:underline"
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
            {createMutation.isPending ? "Création..." : "Créer la commande"}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">N°</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Origine</th>
              <th className="px-4 py-2">Total</th>
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
            {!isLoading && orders?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                  Aucune commande.
                </td>
              </tr>
            )}
            {orders?.map((order) => (
              <tr key={order.id}>
                <td className="px-4 py-2 font-medium">{order.number}</td>
                <td className="px-4 py-2 text-zinc-600">{contactName(order.contactId)}</td>
                <td className="px-4 py-2 text-zinc-600">{order.source}</td>
                <td className="px-4 py-2 text-zinc-600">
                  {order.total} {order.currency}
                </td>
                <td className="px-4 py-2">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                    {STATUS_LABELS[order.status]}
                  </span>
                </td>
                <td className="px-4 py-2 space-x-2">
                  {order.status === "pending" && (
                    <button
                      onClick={() => confirmMutation.mutate(order.id)}
                      className="text-xs text-zinc-600 hover:underline"
                    >
                      Confirmer
                    </button>
                  )}
                  {order.status === "confirmed" && !order.invoiceId && (
                    <button
                      onClick={() => invoiceMutation.mutate(order.id)}
                      className="text-xs text-zinc-600 hover:underline"
                    >
                      Facturer
                    </button>
                  )}
                  {order.status === "confirmed" && (
                    <button
                      onClick={() => fulfillMutation.mutate(order.id)}
                      className="text-xs text-zinc-600 hover:underline"
                    >
                      Livrer
                    </button>
                  )}
                  {(order.status === "pending" || order.status === "confirmed") && (
                    <button
                      onClick={() => cancelMutation.mutate(order.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Annuler
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
