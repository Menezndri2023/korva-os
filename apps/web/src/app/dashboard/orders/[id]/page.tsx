"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addOrderItemSchema, type AddOrderItemInput } from "@korva/validation";
import { FULFILLMENT_MODE_LABELS, FULFILLMENT_MODE_LABELS_EN, type Contact, type Offer, type Order, type Resource } from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useAuthReady } from "@/lib/use-auth-ready";
import { formatCurrency } from "@/lib/analytics-format";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

const STATUS_LABELS: Record<Order["status"], [string, string]> = {
  open: ["Addition ouverte", "Open tab"],
  pending: ["En attente", "Pending"],
  confirmed: ["Confirmée", "Confirmed"],
  fulfilled: ["Livrée", "Fulfilled"],
  cancelled: ["Annulée", "Cancelled"],
};

export default function OrderDetailPage() {
  const locale = useDashboardLocale();
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const { data: organization } = useActiveOrganization();
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
  const resourcesQuery = useQuery({
    queryKey: ["resources", ""],
    queryFn: () => apiClient.get<Resource[]>("/resources"),
    enabled: authReady,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["orders"] });
    void queryClient.invalidateQueries({ queryKey: ["invoices"] });
  };

  const {
    register: registerItem,
    control: itemControl,
    handleSubmit: handleItemSubmit,
    reset: resetItemForm,
  } = useForm<AddOrderItemInput>({
    resolver: zodResolver(addOrderItemSchema),
    defaultValues: { quantity: 1, modifiers: [] },
  });
  const {
    fields: modifierFields,
    append: appendModifier,
    remove: removeModifier,
  } = useFieldArray({ control: itemControl, name: "modifiers" });
  const addItemMutation = useMutation({
    mutationFn: (input: AddOrderItemInput) =>
      apiClient.post<Order>(`/orders/${id}/items`, input),
    onSuccess: () => {
      invalidate();
      resetItemForm({ offerId: "", quantity: 1, modifiers: [] });
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

  const [selectedForSplit, setSelectedForSplit] = useState<Set<number>>(new Set());
  const [lastSplits, setLastSplits] = useState<Order[] | null>(null);
  const splitMutation = useMutation({
    mutationFn: (items: number[]) =>
      apiClient.post<{ original: Order; splits: Order[] }>(`/orders/${id}/split`, {
        groups: [{ items }],
      }),
    onSuccess: (result) => {
      invalidate();
      setSelectedForSplit(new Set());
      setLastSplits(result.splits);
    },
  });
  function toggleSplitSelection(index: number) {
    setSelectedForSplit((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

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
    splitMutation,
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
  function resourceName(resourceId?: string): string {
    if (!resourceId) return "—";
    return resourcesQuery.data?.find((r) => r.id === resourceId)?.name ?? "—";
  }

  if (orderQuery.isLoading) {
    return <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>;
  }

  if (orderQuery.isError || !orderQuery.data) {
    const error = orderQuery.error;
    const message =
      error instanceof ApiError ? error.message : t(
        "Impossible de charger cette commande.",
        "This order could not be loaded.",
      );
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/orders"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          {t("Retour aux commandes", "Back to orders")}
        </Link>
      </Card>
    );
  }

  const order = orderQuery.data;

  return (
    <div className="space-y-4">
      <Link href="/dashboard/orders" className="text-sm text-text-muted hover:underline">
        {t("← Commandes", "← Orders")}
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
            <Badge>{t(...STATUS_LABELS[order.status])}</Badge>
            {order.status === "open" && (
              <Button
                variant="secondary"
                size="sm"
                loading={closeMutation.isPending}
                onClick={() => closeMutation.mutate()}
              >
                {t("Clôturer l'addition", "Close the tab")}
              </Button>
            )}
            {order.status === "pending" && (
              <Button
                variant="secondary"
                size="sm"
                loading={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate()}
              >
                {t("Confirmer", "Confirm")}
              </Button>
            )}
            {order.status === "confirmed" && !order.invoiceId && (
              <Button
                variant="secondary"
                size="sm"
                loading={invoiceMutation.isPending}
                onClick={() => invoiceMutation.mutate()}
              >
                {t("Facturer", "Invoice")}
              </Button>
            )}
            {order.status === "confirmed" && (
              <Button
                variant="secondary"
                size="sm"
                loading={fulfillMutation.isPending}
                onClick={() => fulfillMutation.mutate()}
              >
                {t("Livrer", "Fulfil")}
              </Button>
            )}
            {(order.status === "pending" || order.status === "confirmed") && (
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

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
          <div>
            <dt className="text-text-muted">{t("Origine", "Source")}</dt>
            <dd className="mt-0.5">{order.source}</dd>
          </div>
          <div>
            <dt className="text-text-muted">{t("Créée le", "Created")}</dt>
            <dd className="mt-0.5">{new Date(order.createdAt).toLocaleString(intlLocale(locale))}</dd>
          </div>
          {order.resourceId && (
            <div>
              <dt className="text-text-muted">{t("Table", "Table")}</dt>
              <dd className="mt-0.5">{resourceName(order.resourceId)}</dd>
            </div>
          )}
          {order.fulfillmentMode && (
            <div>
              <dt className="text-text-muted">{t("Réception", "Receiving")}</dt>
              <dd className="mt-0.5">
                {(locale === "en" ? FULFILLMENT_MODE_LABELS_EN : FULFILLMENT_MODE_LABELS)[order.fulfillmentMode]}
                {order.deliveryZoneName && ` · ${order.deliveryZoneName}`}
                {order.tableLabel && ` · ${order.tableLabel}`}
              </dd>
            </div>
          )}
          {order.fulfillmentMode && (
            <div>
              <dt className="text-text-muted">{t("Pour", "For")}</dt>
              <dd className="mt-0.5">
                {order.requestedFor
                  ? // In the business's own timezone: the customer chose this hour on its clock.
                    new Date(order.requestedFor).toLocaleString(intlLocale(locale), {
                      timeZone: organization?.timezone,
                      dateStyle: "medium",
                      timeStyle: "short",
                    })
                  : t("Dès que possible", "As soon as possible")}
              </dd>
            </div>
          )}
          {order.shippingAddress && (
            <div>
              <dt className="text-text-muted">{t("Adresse de livraison", "Delivery address")}</dt>
              <dd className="mt-0.5">
                {order.shippingAddress.line1}
                {order.shippingAddress.line2 && `, ${order.shippingAddress.line2}`},{" "}
                {order.shippingAddress.postalCode} {order.shippingAddress.city}
              </dd>
            </div>
          )}
          {order.shippingCost > 0 && (
            <div>
              <dt className="text-text-muted">{t("Frais de livraison", "Delivery fee")}</dt>
              <dd className="mt-0.5">
                {order.shippingCost} {order.currency}
              </dd>
            </div>
          )}
          {order.invoiceId && (
            <div>
              <dt className="text-text-muted">{t("Facture", "Invoice")}</dt>
              <dd className="mt-0.5">{t("Générée", "Generated")}</dd>
            </div>
          )}
        </dl>

        {order.notes && (
          <div className="mt-4">
            <dt className="text-sm text-text-muted">{t("Notes", "Notes")}</dt>
            <dd className="mt-0.5 text-sm text-text">{order.notes}</dd>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                {order.status === "open" && <th className="px-4 py-2" aria-label={t("Sélection", "Selection")} />}
                <th className="px-4 py-2">{t("Description", "Description")}</th>
                <th className="px-4 py-2">{t("Qté", "Qty")}</th>
                <th className="px-4 py-2">{t("Prix unitaire", "Unit price")}</th>
                <th className="px-4 py-2">{t("TVA", "VAT")}</th>
                <th className="px-4 py-2">{t("Total ligne", "Line total")}</th>
                {order.status === "open" && <th className="px-4 py-2">{t("Actions", "Actions")}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {order.items.length === 0 && (
                <tr>
                  <td
                    colSpan={order.status === "open" ? 7 : 5}
                    className="px-4 py-6 text-center text-text-muted"
                  >
                    {t("Aucun article pour le moment.", "No items yet.")}
                  </td>
                </tr>
              )}
              {order.items.map((item, index) => {
                const modifiersDelta = (item.modifiers ?? []).reduce(
                  (sum, modifier) => sum + modifier.priceDelta,
                  0,
                );
                return (
                <tr key={index}>
                  {order.status === "open" && (
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        aria-label={t(`Sélectionner ${item.description}`, `Select ${item.description}`)}
                        checked={selectedForSplit.has(index)}
                        onChange={() => toggleSplitSelection(index)}
                      />
                    </td>
                  )}
                  <td className="px-4 py-2 font-medium">
                    {item.description}
                    {item.modifiers && item.modifiers.length > 0 && (
                      <p className="mt-0.5 text-xs font-normal text-text-muted">
                        {item.modifiers
                          .map(
                            (m) =>
                              `${m.name} (${m.priceDelta >= 0 ? "+" : ""}${formatCurrency(m.priceDelta, order.currency, locale)})`,
                          )
                          .join(", ")}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 text-text-muted">{item.quantity}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {formatCurrency(item.unitPrice + modifiersDelta, order.currency, locale)}
                  </td>
                  <td className="px-4 py-2 text-text-muted">{item.taxRate ?? 0}%</td>
                  <td className="px-4 py-2 text-text-muted">
                    {formatCurrency(
                      item.quantity *
                        (item.unitPrice + modifiersDelta) *
                        (1 + (item.taxRate ?? 0) / 100),
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
                        {t("Retirer", "Remove")}
                      </button>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-8 border-t border-border px-4 py-3 text-sm">
          <div className="text-right text-text-muted">
            <p>{t("Sous-total", "Subtotal")}</p>
            <p>{t("TVA", "VAT")}</p>
            <p className="font-semibold text-text">{t("Total", "Total")}</p>
          </div>
          <div className="text-right">
            <p>{formatCurrency(order.subtotal, order.currency, locale)}</p>
            <p>{formatCurrency(order.taxTotal, order.currency, locale)}</p>
            <p className="font-semibold">{formatCurrency(order.total, order.currency, locale)}</p>
          </div>
        </div>
        {order.status === "open" && selectedForSplit.size > 0 && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
            <p className="text-sm text-text-muted">
              {t(`${selectedForSplit.size} article(s) sélectionné(s)`, `${selectedForSplit.size} item(s) selected`)}
            </p>
            <Button
              variant="secondary"
              size="sm"
              loading={splitMutation.isPending}
              onClick={() => splitMutation.mutate([...selectedForSplit])}
            >
              {t("Créer une note séparée", "Create a split bill")}
            </Button>
          </div>
        )}
        {lastSplits && lastSplits.length > 0 && (
          <div className="border-t border-border bg-surface-muted px-4 py-3 text-sm">
            <p className="text-text-muted">{t("Note(s) séparée(s) créée(s) :", "Split bill(s) created:")}</p>
            <ul className="mt-1 space-y-0.5">
              {lastSplits.map((split) => (
                <li key={split.id}>
                  <Link
                    href={`/dashboard/orders/${split.id}`}
                    className="text-text underline"
                  >
                    Commande {split.number} — {formatCurrency(split.total, split.currency, locale)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {order.status === "open" && (
          <form
            onSubmit={handleItemSubmit((values) => addItemMutation.mutate(values))}
            className="space-y-2 border-t border-border p-4"
          >
            <div className="flex flex-wrap items-end gap-2">
              <select
                className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
                defaultValue=""
                {...registerItem("offerId")}
              >
                <option value="" disabled>
                  {t("Choisir un article", "Choose an item")}
                </option>
                {offersQuery.data?.map((offer) => (
                  <option key={offer.id} value={offer.id}>
                    {offer.name} — {formatCurrency(offer.pricing.amount, offer.pricing.currency, locale)}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                step="1"
                placeholder={t("Qté", "Qty")}
                className="w-20"
                {...registerItem("quantity", { valueAsNumber: true })}
              />
              <Button type="submit" size="sm" loading={addItemMutation.isPending}>
                {addItemMutation.isPending ? t("Ajout...", "Adding...") : t("Ajouter l'article", "Add the item")}
              </Button>
            </div>
            <div className="space-y-1">
              {modifierFields.map((field, index) => (
                <div key={field.id} className="flex items-center gap-2">
                  <Input
                    placeholder={t("Modificateur (ex: Sans oignon)", "Modifier (e.g. No onion)")}
                    className="w-56"
                    {...registerItem(`modifiers.${index}.name`)}
                  />
                  <Input
                    type="number"
                    step="0.01"
                    placeholder={t("Supplément", "Extra price")}
                    className="w-28"
                    {...registerItem(`modifiers.${index}.priceDelta`, {
                      valueAsNumber: true,
                    })}
                  />
                  <button
                    type="button"
                    onClick={() => removeModifier(index)}
                    className="text-xs text-destructive hover:underline"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => appendModifier({ name: "", priceDelta: 0 })}
                className="text-xs text-text-muted hover:underline"
              >
                {t("+ Ajouter un modificateur", "+ Add a modifier")}
              </button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
