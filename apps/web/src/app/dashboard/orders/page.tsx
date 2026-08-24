"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOrderSchema, type CreateOrderInput } from "@korva/validation";
import type { Contact, Order } from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const STATUS_LABELS: Record<Order["status"], string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  fulfilled: "Livrée",
  cancelled: "Annulée",
};

export default function OrdersPage() {
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const { data: orders, isLoading } = useQuery({
    queryKey: ["orders"],
    queryFn: () => apiClient.get<Order[]>("/orders"),
    enabled: authReady,
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
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
        <p className="mt-1 text-sm text-text-muted">Commandes manuelles, issues du panier ou d&apos;une réservation.</p>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Annuler" : "Nouvelle commande"}</Button>
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
                  className="col-span-1 text-sm text-destructive hover:underline"
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
            {createMutation.isPending ? "Création..." : "Créer la commande"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
            <tr>
              <th className="px-4 py-2">N°</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Origine</th>
              <th className="px-4 py-2">Total</th>
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
            {!isLoading && orders?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-text-muted">
                  Aucune commande.
                </td>
              </tr>
            )}
            {orders?.map((order) => (
              <tr key={order.id}>
                <td className="px-4 py-2 font-medium">{order.number}</td>
                <td className="px-4 py-2 text-text-muted">{contactName(order.contactId)}</td>
                <td className="px-4 py-2 text-text-muted">{order.source}</td>
                <td className="px-4 py-2 text-text-muted">
                  {order.total} {order.currency}
                </td>
                <td className="px-4 py-2">
                  <Badge>{STATUS_LABELS[order.status]}</Badge>
                </td>
                <td className="px-4 py-2 space-x-2">
                  {order.status === "pending" && (
                    <button
                      onClick={() => confirmMutation.mutate(order.id)}
                      className="text-xs text-text-muted hover:underline"
                    >
                      Confirmer
                    </button>
                  )}
                  {order.status === "confirmed" && !order.invoiceId && (
                    <button
                      onClick={() => invoiceMutation.mutate(order.id)}
                      className="text-xs text-text-muted hover:underline"
                    >
                      Facturer
                    </button>
                  )}
                  {order.status === "confirmed" && (
                    <button
                      onClick={() => fulfillMutation.mutate(order.id)}
                      className="text-xs text-text-muted hover:underline"
                    >
                      Livrer
                    </button>
                  )}
                  {(order.status === "pending" || order.status === "confirmed") && (
                    <button
                      onClick={() => cancelMutation.mutate(order.id)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Annuler
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
