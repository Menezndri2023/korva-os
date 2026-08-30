"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addOrderItemSchema, type AddOrderItemInput } from "@korva/validation";
import type { Contact, Offer, Order } from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { formatCurrency } from "@/lib/analytics-format";

const STATUS_LABELS: Record<Order["status"], string> = {
  open: "Addition ouverte",
  pending: "En attente",
  confirmed: "Confirmée",
  fulfilled: "Livrée",
  cancelled: "Annulée",
};

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const orderQuery = useQuery({
    queryKey: ["orders", id],
    queryFn: () => apiClient.get<Order>(`/orders/${id}`),
    enabled: authReady,
  });
  const contactsQuery = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const offersQuery = useQuery({
    queryKey: ["offers", ""],
    queryFn: () => apiClient.get<Offer[]>("/offers"),
    enabled: authReady,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
  };

  const {
    register: registerItem,
    handleSubmit: handleItemSubmit,
    reset: resetItemForm,
  } = useForm<AddOrderItemInput>({
    resolver: zodResolver(addOrderItemSchema),
    defaultValues: { quantity: 1 },
  });
  const addItemMutation = useMutation({
    mutationFn: (input: AddOrderItemInput) =>
      apiClient.post<Order>(`/orders/${id}/items`, input),
    onSuccess: () => {
      invalidate();
      resetItemForm({ offerId: "", quantity: 1 });
    },
  });
  const removeItemMutation = useMutation({
    mutationFn: (index: number) => apiClient.delete<Order>(`/orders/${id}/items/${index}`),
    onSuccess: invalidate,
  });
  const closeMutation = useMutation({
    mutationFn: () => apiClient.post<Order>(`/orders/${id}/close`),
    onSuccess: invalidate,
  });

  const confirmMutation = useMutation({
    mutationFn: () => apiClient.post(`/orders/${id}/confirm`),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: () => apiClient.post(`/orders/${id}/cancel`),
    onSuccess: invalidate,
  });
  const fulfillMutation = useMutation({
    mutationFn: () => apiClient.post(`/orders/${id}/fulfill`),
    onSuccess: invalidate,
  });
  const invoiceMutation = useMutation({
    mutationFn: () => apiClient.post(`/orders/${id}/generate-invoice`),
    onSuccess: invalidate,
  });

  const actionError = [
    confirmMutation,
    cancelMutation,
    fulfillMutation,
    invoiceMutation,
    closeMutation,
    addItemMutation,
    removeItemMutation,
  ]
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

  if (orderQuery.isLoading) {
    return <p className="text-sm text-text-muted">Chargement...</p>;
  }

  if (orderQuery.isError || !orderQuery.data) {
    const error = orderQuery.error;
    const message =
      error instanceof ApiError ? error.message : "Impossible de charger cette commande.";
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/orders"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          Retour aux commandes
        </Link>
      </Card>
    );
  }

  const order = orderQuery.data;

  return (
    <div className="space-y-4">
      <Link href="/dashboard/orders" className="text-sm text-text-muted hover:underline">
        ← Commandes
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{order.number}</h1>
            <Link
              href={`/dashboard/crm/${order.contactId}`}
              className="text-sm text-text-muted underline-offset-2 hover:underline"
            >
              {contactName(order.contactId)}
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{STATUS_LABELS[order.status]}</Badge>
            {order.status === "open" && (
              <Button
                variant="secondary"
                size="sm"
                loading={closeMutation.isPending}
                onClick={() => closeMutation.mutate()}
              >
                Clôturer l&apos;addition
              </Button>
            )}
            {order.status === "pending" && (
              <Button
                variant="secondary"
                size="sm"
                loading={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate()}
              >
                Confirmer
              </Button>
            )}
            {order.status === "confirmed" && !order.invoiceId && (
              <Button
                variant="secondary"
                size="sm"
                loading={invoiceMutation.isPending}
                onClick={() => invoiceMutation.mutate()}
              >
                Facturer
              </Button>
            )}
            {order.status === "confirmed" && (
              <Button
                variant="secondary"
                size="sm"
                loading={fulfillMutation.isPending}
                onClick={() => fulfillMutation.mutate()}
              >
                Livrer
              </Button>
            )}
            {(order.status === "pending" || order.status === "confirmed") && (
              <Button
                variant="ghost"
                size="sm"
                loading={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
              >
                Annuler
              </Button>
            )}
          </div>
        </div>

        {actionError instanceof ApiError && (
          <p className="mt-3 text-sm text-destructive">{actionError.message}</p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          <div>
            <dt className="text-text-muted">Origine</dt>
            <dd className="mt-0.5">{order.source}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Créée le</dt>
            <dd className="mt-0.5">{new Date(order.createdAt).toLocaleString("fr-FR")}</dd>
          </div>
          {order.invoiceId && (
            <div>
              <dt className="text-text-muted">Facture</dt>
              <dd className="mt-0.5">Générée</dd>
            </div>
          )}
        </dl>

        {order.notes && (
          <div className="mt-4">
            <dt className="text-sm text-text-muted">Notes</dt>
            <dd className="mt-0.5 text-sm text-text">{order.notes}</dd>
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
                {order.status === "open" && <th className="px-4 py-2">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.items.length === 0 && (
                <tr>
                  <td
                    colSpan={order.status === "open" ? 6 : 5}
                    className="px-4 py-6 text-center text-text-muted"
                  >
                    Aucun article pour le moment.
                  </td>
                </tr>
              )}
              {order.items.map((item, index) => (
                <tr key={index}>
                  <td className="px-4 py-2 font-medium">{item.description}</td>
                  <td className="px-4 py-2 text-text-muted">{item.quantity}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {formatCurrency(item.unitPrice, order.currency)}
                  </td>
                  <td className="px-4 py-2 text-text-muted">{item.taxRate ?? 0}%</td>
                  <td className="px-4 py-2 text-text-muted">
                    {formatCurrency(
                      item.quantity * item.unitPrice * (1 + (item.taxRate ?? 0) / 100),
                      order.currency,
                    )}
                  </td>
                  {order.status === "open" && (
                    <td className="px-4 py-2">
                      <button
                        onClick={() => removeItemMutation.mutate(index)}
                        disabled={removeItemMutation.isPending}
                        className="text-xs text-destructive hover:underline"
                      >
                        Retirer
                      </button>
                    </td>
                  )}
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
            <p>{formatCurrency(order.subtotal, order.currency)}</p>
            <p>{formatCurrency(order.taxTotal, order.currency)}</p>
            <p className="font-semibold">{formatCurrency(order.total, order.currency)}</p>
          </div>
        </div>
        {order.status === "open" && (
          <form
            onSubmit={handleItemSubmit((values) => addItemMutation.mutate(values))}
            className="flex flex-wrap items-end gap-2 border-t border-border p-4"
          >
            <select
              className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
              defaultValue=""
              {...registerItem("offerId")}
            >
              <option value="" disabled>
                Choisir un article
              </option>
              {offersQuery.data?.map((offer) => (
                <option key={offer.id} value={offer.id}>
                  {offer.name} — {formatCurrency(offer.pricing.amount, offer.pricing.currency)}
                </option>
              ))}
            </select>
            <Input
              type="number"
              step="1"
              placeholder="Qté"
              className="w-20"
              {...registerItem("quantity", { valueAsNumber: true })}
            />
            <Button type="submit" size="sm" loading={addItemMutation.isPending}>
              {addItemMutation.isPending ? "Ajout..." : "Ajouter l'article"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
