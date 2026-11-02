"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Contact, Offer, Resource, WaitlistEntry } from "@korva/types";
import { Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

const STATUS_LABELS: Record<WaitlistEntry["status"], [string, string]> = {
  waiting: ["En attente", "Waiting"],
  notified: ["Prévenu", "Notified"],
  cancelled: ["Annulé", "Cancelled"],
};

interface WaitlistFormValues {
  resourceId: string;
  offerId: string;
  contactId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export default function WaitlistPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const authReady = useAuthReady();
  const locale = useDashboardLocale();
  const t = useT();

  const { data: entriesPage, isLoading } = useQuery({
    queryKey: ["waitlist", page],
    queryFn: () => apiClient.getList<WaitlistEntry>(`/waitlist?page=${page}`),
    enabled: authReady,
  });
  const entries = entriesPage?.data;

  const { data: resources } = useQuery({
    queryKey: ["resources", ""],
    queryFn: () => apiClient.get<Resource[]>("/resources"),
    enabled: authReady,
  });
  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const { data: offers } = useQuery({
    queryKey: ["offers", "booking"],
    queryFn: () => apiClient.get<Offer[]>("/offers?type=booking"),
    enabled: authReady,
  });

  function resourceName(id: string): string {
    return resources?.find((r) => r.id === id)?.name ?? "—";
  }
  function contactName(id: string): string {
    const contact = contacts?.find((c) => c.id === id);
    if (!contact) return "—";
    return (
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.company ||
      "—"
    );
  }

  const { register, handleSubmit, reset } = useForm<WaitlistFormValues>();

  const createMutation = useMutation({
    mutationFn: (values: WaitlistFormValues) =>
      apiClient.post<WaitlistEntry>("/waitlist", {
        resourceId: values.resourceId,
        offerId: values.offerId,
        contactId: values.contactId,
        startAt: new Date(`${values.date}T${values.startTime}:00.000Z`).toISOString(),
        endAt: new Date(`${values.date}T${values.endTime}:00.000Z`).toISOString(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["waitlist"] });
      reset();
      setShowForm(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/waitlist/${id}/cancel`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["waitlist"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          {t(
            "Clients en attente d'un créneau complet — prévenus automatiquement dès qu'une annulation libère leur plage souhaitée.",
            "Customers waiting for a full slot — told automatically as soon as a cancellation frees the time they want.",
          )}
        </p>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("Annuler", "Cancel") : t("Ajouter à la liste d'attente", "Add to the waiting list")}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3 rounded-lg border border-border bg-white p-4"
        >
          <div className="grid grid-cols-3 gap-2">
            <select
              className="rounded-md border border-border-input px-3 py-2 text-sm"
              defaultValue=""
              {...register("resourceId", { required: true })}
            >
              <option value="" disabled>
                {t("Ressource", "Resource")}
              </option>
              {resources?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-border-input px-3 py-2 text-sm"
              defaultValue=""
              {...register("offerId", { required: true })}
            >
              <option value="" disabled>
                {t("Offre", "Offer")}
              </option>
              {offers?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-border-input px-3 py-2 text-sm"
              defaultValue=""
              {...register("contactId", { required: true })}
            >
              <option value="" disabled>
                {t("Client", "Customer")}
              </option>
              {contacts?.map((c) => (
                <option key={c.id} value={c.id}>
                  {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Input type="date" {...register("date", { required: true })} />
            <Input type="time" {...register("startTime", { required: true })} />
            <Input type="time" {...register("endTime", { required: true })} />
          </div>

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              {createMutation.error instanceof ApiError
                ? createMutation.error.message
                : t("Erreur", "Error")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? t("Ajout...", "Adding...") : t("Ajouter", "Add")}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">{t("Ressource", "Resource")}</th>
                <th className="px-4 py-2">{t("Client", "Customer")}</th>
                <th className="px-4 py-2">{t("Créneau souhaité", "Wanted slot")}</th>
                <th className="px-4 py-2">{t("Statut", "Status")}</th>
                <th className="px-4 py-2">{t("Actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    {t("Chargement...", "Loading...")}
                  </td>
                </tr>
              )}
              {!isLoading && entries?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    {t("Aucune entrée en liste d'attente.", "Nobody on the waiting list.")}
                  </td>
                </tr>
              )}
              {entries?.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-2 font-medium">{resourceName(entry.resourceId)}</td>
                  <td className="px-4 py-2 text-text-muted">{contactName(entry.contactId)}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {new Date(entry.startAt).toLocaleString(intlLocale(locale))} –{" "}
                    {new Date(entry.endAt).toLocaleTimeString(intlLocale(locale))}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-text">
                      {t(...STATUS_LABELS[entry.status])}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {entry.status === "waiting" && (
                      <button
                        onClick={() => cancelMutation.mutate(entry.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        {t("Retirer", "Remove")}
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
        totalPages={entriesPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
