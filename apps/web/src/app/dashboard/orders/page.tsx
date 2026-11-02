"use client";

import Link from "next/link";
import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOpenOrderSchema,
  createOrderSchema,
  type CreateOpenOrderInput,
  type CreateOrderInput,
} from "@korva/validation";
import { FULFILLMENT_MODE_LABELS, FULFILLMENT_MODE_LABELS_EN, type Contact, type Order, type Resource } from "@korva/types";
import { Badge, Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

const STATUS_LABELS: Record<Order["status"], [string, string]> = {
  open: ["Addition ouverte", "Open tab"],
  pending: ["En attente", "Pending"],
  confirmed: ["Confirmée", "Confirmed"],
  fulfilled: ["Livrée", "Fulfilled"],
  cancelled: ["Annulée", "Cancelled"],
};

export default function OrdersPage() {
  const locale = useDashboardLocale();
  const t = useT();
  const [showForm, setShowForm] = useState(false);
  const [showOpenForm, setShowOpenForm] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const { data: organization } = useActiveOrganization();

  const { data: ordersPage, isLoading } = useQuery({
    queryKey: ["orders", page],
    queryFn: () => apiClient.getList<Order>(`/orders?page=${page}`),
    enabled: authReady,
  });
  const orders = ordersPage?.data;
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const { data: resources } = useQuery({
    queryKey: ["resources", ""],
    queryFn: () => apiClient.get<Resource[]>("/resources"),
    // Tables are booking resources: a shop without the booking module has none to name.
    enabled: authReady && Boolean(organization?.enabledModules.includes("booking")),
  });
  function resourceName(resourceId?: string): string {
    if (!resourceId) return "—";
    return resources?.find((r) => r.id === resourceId)?.name ?? "—";
  }

  const { register, control, handleSubmit, reset } = useForm<CreateOrderInput>({
    resolver: zodResolver(createOrderSchema),
    defaultValues: {
      currency: "EUR",
      items: [{ description: "", quantity: 1, unitPrice: 0, taxRate: 0 }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const {
    register: registerOpen,
    handleSubmit: handleOpenSubmit,
    reset: resetOpenForm,
  } = useForm<CreateOpenOrderInput>({
    resolver: zodResolver(createOpenOrderSchema),
    defaultValues: { currency: "EUR" },
  });

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
  const createOpenMutation = useMutation({
    mutationFn: (input: CreateOpenOrderInput) =>
      apiClient.post<Order>("/orders/open", input),
    onSuccess: () => {
      invalidate();
      resetOpenForm();
      setShowOpenForm(false);
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
        <h1 className="text-2xl font-semibold">{t("Commandes", "Orders")}</h1>
        <p className="mt-1 text-sm text-text-muted">{t(
          "Commandes manuelles, issues du panier ou d'une réservation.",
          "Orders entered by hand, from the basket or from a booking.",
        )}</p>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={() => setShowOpenForm((v) => !v)}>
          {showOpenForm ? t("Annuler", "Cancel") : t("Ouvrir une addition", "Open a tab")}
        </Button>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? t("Annuler", "Cancel") : t("Nouvelle commande", "New order")}</Button>
      </div>

      {showOpenForm && (
        <form
          onSubmit={handleOpenSubmit((values) => createOpenMutation.mutate(values))}
          className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-4"
        >
          <select
            className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            defaultValue=""
            {...registerOpen("contactId")}
          >
            <option value="" disabled>
              {t("Choisir un client", "Choose a customer")}
            </option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email}
              </option>
            ))}
          </select>
          <Input placeholder={t("Devise (EUR)", "Currency (EUR)")} className="w-28" {...registerOpen("currency")} />
          <select
            className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            defaultValue=""
            {...registerOpen("resourceId", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          >
            <option value="">{t("Table (optionnel)", "Table (optional)")}</option>
            {resources?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {createOpenMutation.isError && (
            <p className="w-full text-sm text-destructive">
              {createOpenMutation.error instanceof ApiError
                ? createOpenMutation.error.message
                : t("Erreur", "Error")}
            </p>
          )}
          <Button type="submit" loading={createOpenMutation.isPending}>
            {createOpenMutation.isPending ? t("Ouverture...", "Opening...") : t("Ouvrir", "Open")}
          </Button>
        </form>
      )}

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
              {t("Choisir un client", "Choose a customer")}
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
                  placeholder={t("Description", "Description")}
                  className="col-span-5"
                  {...register(`items.${index}.description`)}
                />
                <Input
                  type="number"
                  placeholder={t("Qté", "Qty")}
                  className="col-span-2"
                  {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                />
                <Input
                  type="number"
                  step="0.01"
                  placeholder={t("Prix unitaire", "Unit price")}
                  className="col-span-2"
                  {...register(`items.${index}.unitPrice`, { valueAsNumber: true })}
                />
                <Input
                  type="number"
                  placeholder={t("TVA %", "VAT %")}
                  className="col-span-2"
                  {...register(`items.${index}.taxRate`, {
                    setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
                  })}
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
              {t("+ Ajouter une ligne", "+ Add a line")}
            </button>
          </div>

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof ApiError ? createMutation.error.message : t("Erreur", "Error")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer la commande", "Create the order")}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">{t("N°", "No.")}</th>
                <th className="px-4 py-2">{t("Client", "Customer")}</th>
                <th className="px-4 py-2">{t("Table", "Table")}</th>
                <th className="px-4 py-2">{t("Origine", "Source")}</th>
                <th className="px-4 py-2">{t("Total", "Total")}</th>
                <th className="px-4 py-2">{t("Statut", "Status")}</th>
                <th className="px-4 py-2">{t("Actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-text-muted">
                    {t("Chargement...", "Loading...")}
                  </td>
                </tr>
              )}
              {!isLoading && orders?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-text-muted">
                    {t("Aucune commande.", "No orders.")}
                  </td>
                </tr>
              )}
              {orders?.map((order) => (
                <tr key={order.id}>
                  <td className="px-4 py-2 font-medium">
                    <Link
                      href={`/dashboard/orders/${order.id}`}
                      className="text-text underline-offset-2 hover:underline"
                    >
                      {order.number}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-text-muted">{contactName(order.contactId)}</td>
                  <td className="px-4 py-2 text-text-muted">{resourceName(order.resourceId)}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {order.source}
                    {order.fulfillmentMode && (
                      <span className="block text-xs">
                        {(locale === "en" ? FULFILLMENT_MODE_LABELS_EN : FULFILLMENT_MODE_LABELS)[order.fulfillmentMode]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-text-muted">
                    {order.total} {order.currency}
                  </td>
                  <td className="px-4 py-2">
                    <Badge>{t(...STATUS_LABELS[order.status])}</Badge>
                  </td>
                  <td className="px-4 py-2 space-x-2">
                    {order.status === "pending" && (
                      <button
                        onClick={() => confirmMutation.mutate(order.id)}
                        className="text-xs text-text-muted hover:underline"
                      >
                        {t("Confirmer", "Confirm")}
                      </button>
                    )}
                    {order.status === "confirmed" && !order.invoiceId && (
                      <button
                        onClick={() => invoiceMutation.mutate(order.id)}
                        className="text-xs text-text-muted hover:underline"
                      >
                        {t("Facturer", "Invoice")}
                      </button>
                    )}
                    {order.status === "confirmed" && (
                      <button
                        onClick={() => fulfillMutation.mutate(order.id)}
                        className="text-xs text-text-muted hover:underline"
                      >
                        {t("Livrer", "Fulfil")}
                      </button>
                    )}
                    {(order.status === "pending" || order.status === "confirmed") && (
                      <button
                        onClick={() => cancelMutation.mutate(order.id)}
                        className="text-xs text-destructive hover:underline"
                      >
                        {t("Annuler", "Cancel")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Pagination
        page={page}
        totalPages={ordersPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
