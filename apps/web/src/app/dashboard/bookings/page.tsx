"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Booking, Contact, DayAvailability, Offer, Resource } from "@korva/types";
import { Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

const BOOKING_STATUS_LABELS: Record<Booking["status"], [string, string]> = {
  pending: ["En attente", "Pending"],
  confirmed: ["Confirmée", "Confirmed"],
  cancelled: ["Annulée", "Cancelled"],
  completed: ["Terminée", "Completed"],
};

interface BookingFormValues {
  resourceId: string;
  offerId: string;
  contactId: string;
  date: string;
  startTime: string;
  endTime: string;
}

interface MemberOption {
  id: string;
  userId: { firstName?: string; lastName?: string; email: string };
}

function memberName(member: MemberOption): string {
  return (
    [member.userId.firstName, member.userId.lastName].filter(Boolean).join(" ") ||
    member.userId.email
  );
}

export default function BookingsPage() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const [staffFilter, setStaffFilter] = useState("");
  const authReady = useAuthReady();
  const locale = useDashboardLocale();
  const t = useT();

  const { data: bookingsPage, isLoading } = useQuery({
    queryKey: ["bookings", page],
    queryFn: () => apiClient.getList<Booking>(`/bookings?page=${page}`),
    enabled: authReady,
  });
  const bookings = bookingsPage?.data;
  const { data: resources } = useQuery({
    queryKey: ["resources", staffFilter],
    queryFn: () =>
      apiClient.get<Resource[]>(
        `/resources${staffFilter ? `?membershipId=${staffFilter}` : ""}`,
      ),
    enabled: authReady,
  });
  const { data: members } = useQuery({
    queryKey: ["organizations", "me", "members"],
    queryFn: () => apiClient.get<MemberOption[]>("/organizations/me/members"),
    enabled: authReady,
  });
  function staffName(membershipId?: string): string {
    const member = members?.find((m) => m.id === membershipId);
    return member ? memberName(member) : "—";
  }
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
          {showForm ? t("Annuler", "Cancel") : t("Nouvelle réservation", "New booking")}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion already documented in
          // dashboard/crm/page.tsx (F2-B.7) and dashboard/crm/leads/page.tsx (F2-B.8).
          className="space-y-3 rounded-lg border border-border bg-white p-4"
        >
          <select
            className="rounded-md border border-border-input px-3 py-2 text-sm"
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
          >
            <option value="">{t("Tous les praticiens", "All practitioners")}</option>
            {members?.map((member) => (
              <option key={member.id} value={member.id}>
                {memberName(member)}
              </option>
            ))}
          </select>

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
                  {r.membershipId ? ` — ${staffName(r.membershipId)}` : ""}
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

          {dayAvailability && (
            <div className="rounded-md bg-surface-muted p-3 text-xs text-text-muted">
              <p>
                {t("Horaires du jour :", "Opening hours that day:")}{" "}
                {dayAvailability.windows.map((w) => `${w.startTime}-${w.endTime}`).join(", ") || t("fermé", "closed")}
              </p>
              <p>
                {t("Réservations existantes :", "Existing bookings:")} {dayAvailability.bookings.length}
              </p>
            </div>
          )}

          {createMutation.isError && (
            <p className="text-sm text-red-600">
              {createMutation.error instanceof ApiError ? createMutation.error.message : t("Erreur", "Error")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer la réservation", "Create the booking")}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">{t("Ressource", "Resource")}</th>
                <th className="px-4 py-2">{t("Praticien", "Practitioner")}</th>
                <th className="px-4 py-2">{t("Client", "Customer")}</th>
                <th className="px-4 py-2">{t("Début", "Start")}</th>
                <th className="px-4 py-2">{t("Fin", "End")}</th>
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
              {!isLoading && bookings?.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-text-muted">
                    {t("Aucune réservation.", "No bookings.")}
                  </td>
                </tr>
              )}
              {bookings?.map((booking) => (
                <tr key={booking.id}>
                  <td className="px-4 py-2 font-medium">
                    <Link
                      href={`/dashboard/bookings/${booking.id}`}
                      className="text-text underline-offset-2 hover:underline"
                    >
                      {resourceName(booking.resourceId)}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-text-muted">
                    {staffName(booking.staffMembershipId)}
                  </td>
                  <td className="px-4 py-2 text-text-muted">{contactName(booking.contactId)}</td>
                  <td className="px-4 py-2 text-text-muted">{new Date(booking.startAt).toLocaleString(intlLocale(locale), { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="px-4 py-2 text-text-muted">{new Date(booking.endAt).toLocaleString(intlLocale(locale), { dateStyle: "short", timeStyle: "short" })}</td>
                  <td className="px-4 py-2">
                    <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs text-text">
                      {t(...BOOKING_STATUS_LABELS[booking.status])}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    {(booking.status === "pending" || booking.status === "confirmed") && (
                      <button
                        onClick={() => cancelMutation.mutate(booking.id)}
                        className="text-xs text-red-600 hover:underline"
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
        totalPages={bookingsPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
