"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Booking, Contact, Offer, Order, Resource } from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { formatCurrency } from "@/lib/analytics-format";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

const STATUS_LABELS: Record<Booking["status"], [string, string]> = {
  pending: ["En attente", "Pending"],
  confirmed: ["Confirmée", "Confirmed"],
  cancelled: ["Annulée", "Cancelled"],
  completed: ["Terminée", "Completed"],
};

const PAYMENT_STATUS_LABELS: Record<Booking["paymentStatus"], [string, string]> = {
  unpaid: ["Non payé", "Unpaid"],
  deposit_paid: ["Acompte versé", "Deposit paid"],
  paid: ["Payé", "Paid"],
};

interface RescheduleFormValues {
  date: string;
  startTime: string;
  endTime: string;
}

export default function BookingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const [isRescheduling, setIsRescheduling] = useState(false);
  const locale = useDashboardLocale();
  const t = useT();
  const intl = intlLocale(locale);

  const bookingQuery = useQuery({
    queryKey: ["bookings", id],
    queryFn: () => apiClient.get<Booking>(`/bookings/${id}`),
    enabled: authReady,
  });
  const contactsQuery = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const resourcesQuery = useQuery({
    queryKey: ["resources"],
    queryFn: () => apiClient.get<Resource[]>("/resources"),
    enabled: authReady,
  });
  const offersQuery = useQuery({
    queryKey: ["offers", "booking"],
    queryFn: () => apiClient.get<Offer[]>("/offers?type=booking"),
    enabled: authReady,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["bookings"] });
    void queryClient.invalidateQueries({ queryKey: ["availability"] });
  };
  const cancelMutation = useMutation({
    mutationFn: () => apiClient.post(`/bookings/${id}/cancel`),
    onSuccess: invalidate,
  });
  const completeMutation = useMutation({
    mutationFn: (attended: boolean) =>
      apiClient.post<Booking>(`/bookings/${id}/complete`, { attended }),
    onSuccess: invalidate,
  });

  const { register, handleSubmit, reset } = useForm<RescheduleFormValues>();
  const rescheduleMutation = useMutation({
    mutationFn: (values: RescheduleFormValues) =>
      apiClient.post<Booking>(`/bookings/${id}/reschedule`, {
        startAt: new Date(`${values.date}T${values.startTime}:00.000Z`).toISOString(),
        endAt: new Date(`${values.date}T${values.endTime}:00.000Z`).toISOString(),
      }),
    onSuccess: () => {
      invalidate();
      reset();
      setIsRescheduling(false);
    },
  });

  // Backend endpoint (POST /orders/from-booking) already existed with no way to reach it from
  // the UI — the shared Order Engine's booking→order handoff was backend-only. There is no
  // client-side signal for "an order already exists for this booking" (orders aren't filterable
  // by bookingId), so ORDER_ALREADY_EXISTS is handled as a friendly, specific message here
  // rather than pre-hiding the button.
  const createOrderMutation = useMutation({
    mutationFn: () => apiClient.post<Order>("/orders/from-booking", { bookingId: id }),
    onSuccess: (order) => router.push(`/dashboard/orders/${order.id}`),
  });

  const actionError = [
    cancelMutation,
    rescheduleMutation,
    createOrderMutation,
    completeMutation,
  ]
    .map((mutation) => mutation.error)
    .find((error) => error instanceof ApiError);
  const orderAlreadyExists =
    createOrderMutation.error instanceof ApiError &&
    createOrderMutation.error.code === "ORDER_ALREADY_EXISTS";

  function contactName(contactId: string): string {
    const contact = contactsQuery.data?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return (
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.company ||
      "—"
    );
  }
  function resourceName(resourceId: string): string {
    return resourcesQuery.data?.find((r) => r.id === resourceId)?.name ?? "—";
  }
  function offerName(offerId: string): string {
    return offersQuery.data?.find((o) => o.id === offerId)?.name ?? "—";
  }

  if (bookingQuery.isLoading) {
    return <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>;
  }

  if (bookingQuery.isError || !bookingQuery.data) {
    const error = bookingQuery.error;
    const message =
      error instanceof ApiError ? error.message : t("Impossible de charger cette réservation.", "This booking could not be loaded.");
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/bookings"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          {t("Retour aux réservations", "Back to bookings")}
        </Link>
      </Card>
    );
  }

  const booking = bookingQuery.data;

  return (
    <div className="space-y-4">
      <Link href="/dashboard/bookings" className="text-sm text-text-muted hover:underline">
        ← {t("Réservations", "Bookings")}
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{resourceName(booking.resourceId)}</h1>
            <Link
              href={`/dashboard/crm/${booking.contactId}`}
              className="text-sm text-text-muted underline-offset-2 hover:underline"
            >
              {contactName(booking.contactId)}
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{t(...STATUS_LABELS[booking.status])}</Badge>
            <Badge>{t(...PAYMENT_STATUS_LABELS[booking.paymentStatus])}</Badge>
            {(booking.status === "confirmed" || booking.status === "completed") && (
              <Button
                variant="secondary"
                size="sm"
                loading={createOrderMutation.isPending}
                disabled={isRescheduling}
                onClick={() => createOrderMutation.mutate()}
              >
                {createOrderMutation.isPending ? t("Création...", "Creating...") : t("Créer une commande", "Create an order")}
              </Button>
            )}
            {(booking.status === "pending" || booking.status === "confirmed") && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={cancelMutation.isPending}
                  onClick={() => (isRescheduling ? setIsRescheduling(false) : setIsRescheduling(true))}
                >
                  {isRescheduling ? t("Annuler la modification", "Cancel the change") : t("Déplacer", "Move")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isRescheduling}
                  loading={completeMutation.isPending && completeMutation.variables === true}
                  onClick={() => completeMutation.mutate(true)}
                >
                  {t("Marquer présent(e)", "Mark as attended")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={isRescheduling}
                  loading={completeMutation.isPending && completeMutation.variables === false}
                  onClick={() => completeMutation.mutate(false)}
                >
                  {t("Marquer absent(e)", "Mark as no-show")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isRescheduling}
                  loading={cancelMutation.isPending}
                  onClick={() => cancelMutation.mutate()}
                >
                  {t("Annuler la réservation", "Cancel the booking")}
                </Button>
              </>
            )}
          </div>
        </div>

        {orderAlreadyExists ? (
          <p className="mt-3 text-sm text-text-muted">
            {t("Une commande existe déjà pour cette réservation.", "An order already exists for this booking.")}
          </p>
        ) : (
          actionError instanceof ApiError && (
            <p className="mt-3 text-sm text-destructive">{actionError.message}</p>
          )
        )}

        {!isRescheduling ? (
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            <div>
              <dt className="text-text-muted">{t("Offre", "Offer")}</dt>
              <dd className="mt-0.5">{offerName(booking.offerId)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Début", "Start")}</dt>
              <dd className="mt-0.5">{new Date(booking.startAt).toLocaleString(intl)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Fin", "End")}</dt>
              <dd className="mt-0.5">{new Date(booking.endAt).toLocaleString(intl)}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Prix", "Price")}</dt>
              <dd className="mt-0.5">
                {formatCurrency(booking.pricing.amount, booking.pricing.currency, locale)}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Rappel", "Reminder")}</dt>
              <dd className="mt-0.5">
                {booking.reminderSentAt
                  ? t(
                      `Envoyé le ${new Date(booking.reminderSentAt).toLocaleString("fr-FR")}`,
                      `Sent ${new Date(booking.reminderSentAt).toLocaleString(intl)}`,
                    )
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Présence", "Attendance")}</dt>
              <dd className="mt-0.5">
                {booking.attended === undefined
                  ? "—"
                  : booking.attended
                    ? t("Présent(e)", "Attended")
                    : t("Absent(e)", "No-show")}
              </dd>
            </div>
          </dl>
        ) : (
          <form
            onSubmit={handleSubmit((values) => rescheduleMutation.mutate(values))}
            className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-4"
          >
            <Input type="date" {...register("date", { required: true })} />
            <Input type="time" {...register("startTime", { required: true })} />
            <Input type="time" {...register("endTime", { required: true })} />
            <Button type="submit" size="sm" loading={rescheduleMutation.isPending}>
              {rescheduleMutation.isPending ? "..." : t("Confirmer le nouveau créneau", "Confirm the new slot")}
            </Button>
          </form>
        )}

        {booking.notes && (
          <div className="mt-4">
            <dt className="text-sm text-text-muted">{t("Notes", "Notes")}</dt>
            <dd className="mt-0.5 text-sm text-text">{booking.notes}</dd>
          </div>
        )}
      </Card>
    </div>
  );
}
