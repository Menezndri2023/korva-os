"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Contact, Offer, Resource, WaitlistEntry } from "@korva/types";
import { Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const STATUS_LABELS: Record<WaitlistEntry["status"], string> = {
  waiting: "En attente",
  notified: "Prévenu",
  cancelled: "Annulé",
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
        <p className="text-sm text-zinc-500">
          Clients en attente d&apos;un créneau complet — prévenus automatiquement dès qu&apos;une
          annulation libère leur plage souhaitée.
        </p>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Ajouter à la liste d'attente"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <div className="grid grid-cols-3 gap-2">
            <select
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue=""
              {...register("resourceId", { required: true })}
            >
              <option value="" disabled>
                Ressource
              </option>
              {resources?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue=""
              {...register("offerId", { required: true })}
            >
              <option value="" disabled>
                Offre
              </option>
              {offers?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
              defaultValue=""
              {...register("contactId", { required: true })}
            >
              <option value="" disabled>
                Client
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
                : "Erreur"}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? "Ajout..." : "Ajouter"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2">Ressource</th>
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">Créneau souhaité</th>
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
              {!isLoading && entries?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                    Aucune entrée en liste d&apos;attente.
                  </td>
                </tr>
              )}
              {entries?.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-2 font-medium">{resourceName(entry.resourceId)}</td>
                  <td className="px-4 py-2 text-zinc-600">{contactName(entry.contactId)}</td>
                  <td className="px-4 py-2 text-zinc-600">
                    {new Date(entry.startAt).toLocaleString()} –{" "}
                    {new Date(entry.endAt).toLocaleTimeString()}
                  </td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                      {STATUS_LABELS[entry.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {entry.status === "waiting" && (
                      <button
                        onClick={() => cancelMutation.mutate(entry.id)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Retirer
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
