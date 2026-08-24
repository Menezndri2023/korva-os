"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Booking, Contact, DayAvailability, Offer, Resource } from "@korva/types";
import { Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const STATUS_LABELS: Record<Booking["status"], string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  cancelled: "Annulée",
  completed: "Terminée",
};

interface BookingFormValues {
  resourceId: string;
  offerId: string;
  contactId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export default function BookingsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const authReady = useAuthReady();

  const { data: bookings, isLoading } = useQuery({
    queryKey: ["bookings"],
    queryFn: () => apiClient.get<Booking[]>("/bookings"),
    enabled: authReady,
  });
  const { data: resources } = useQuery({
    queryKey: ["resources"],
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

  const { register, handleSubmit, control, reset } = useForm<BookingFormValues>();
  const watchedResourceId = useWatch({ control, name: "resourceId" });
  const watchedDate = useWatch({ control, name: "date" });

  const { data: dayAvailability } = useQuery({
    queryKey: ["availability", watchedResourceId, watchedDate],
    queryFn: () =>
      apiClient.get<DayAvailability>(`/availability?resourceId=${watchedResourceId}&date=${watchedDate}`),
    enabled: authReady && Boolean(watchedResourceId && watchedDate),
  });

  const createMutation = useMutation({
    mutationFn: (values: BookingFormValues) =>
      apiClient.post<Booking>("/bookings", {
        resourceId: values.resourceId,
        offerId: values.offerId,
        contactId: values.contactId,
        startAt: new Date(`${values.date}T${values.startTime}:00.000Z`).toISOString(),
        endAt: new Date(`${values.date}T${values.endTime}:00.000Z`).toISOString(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["bookings"] });
      void queryClient.invalidateQueries({ queryKey: ["availability"] });
      reset();
      setShowForm(false);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => apiClient.post(`/bookings/${id}/cancel`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["bookings"] }),
  });

  function resourceName(id: string): string {
    return resources?.find((r) => r.id === id)?.name ?? "—";
  }
  function contactName(id: string): string {
    const contact = contacts?.find((c) => c.id === id);
    if (!contact) return "—";
    return [contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.company || "—";
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouvelle réservation"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion already documented in
          // dashboard/crm/page.tsx (F2-B.7) and dashboard/crm/leads/page.tsx (F2-B.8).
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

          {dayAvailability && (
            <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600">
              <p>
                Horaires du jour :{" "}
                {dayAvailability.windows.map((w) => `${w.startTime}-${w.endTime}`).join(", ") || "fermé"}
              </p>
              <p>Réservations existantes : {dayAvailability.bookings.length}</p>
            </div>
          )}

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              {createMutation.error instanceof ApiError ? createMutation.error.message : "Erreur"}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? "Création..." : "Créer la réservation"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Ressource</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Début</th>
              <th className="px-4 py-2">Fin</th>
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
            {!isLoading && bookings?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                  Aucune réservation.
                </td>
              </tr>
            )}
            {bookings?.map((booking) => (
              <tr key={booking.id}>
                <td className="px-4 py-2 font-medium">{resourceName(booking.resourceId)}</td>
                <td className="px-4 py-2 text-zinc-600">{contactName(booking.contactId)}</td>
                <td className="px-4 py-2 text-zinc-600">{new Date(booking.startAt).toLocaleString()}</td>
                <td className="px-4 py-2 text-zinc-600">{new Date(booking.endAt).toLocaleString()}</td>
                <td className="px-4 py-2">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                    {STATUS_LABELS[booking.status]}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {(booking.status === "pending" || booking.status === "confirmed") && (
                    <button
                      onClick={() => cancelMutation.mutate(booking.id)}
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
      </Card>
    </div>
  );
}
