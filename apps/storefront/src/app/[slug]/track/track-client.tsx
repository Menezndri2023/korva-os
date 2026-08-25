"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Badge, Button, Card } from "@korva/ui";
import { publicApiClient } from "@/lib/public-api-client";
import { formatOfferPrice } from "@/lib/offer-labels";
import type { TrackedBooking, TrackedOrder } from "@/lib/public-types";
import type { BookingStatus, OrderStatus } from "@korva/types";

type TrackKind = "order" | "booking";

const ORDER_STEPS: { status: OrderStatus; label: string }[] = [
  { status: "pending", label: "Reçue" },
  { status: "confirmed", label: "Confirmée" },
  { status: "fulfilled", label: "Terminée" },
];

const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "En attente de confirmation",
  confirmed: "Confirmée",
  completed: "Terminée",
  cancelled: "Annulée",
};

/**
 * Customer-facing order/booking tracking. Every load re-queries GET /public/:slug/orders|bookings
 * for real, current data — the looked-up number+email live in the URL query string (not just
 * component state), so a bookmark, a shared link, or a plain page refresh all re-run the same
 * real lookup instead of showing stale or fabricated state.
 */
export default function TrackClient({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlKind: TrackKind = searchParams.get("kind") === "booking" ? "booking" : "order";
  const urlNumber = searchParams.get("number") ?? "";
  const urlEmail = searchParams.get("email") ?? "";
  const hasQuery = urlNumber.trim().length > 0 && urlEmail.trim().length > 0;

  const [kind, setKind] = useState<TrackKind>(urlKind);
  const [number, setNumber] = useState(urlNumber);
  const [email, setEmail] = useState(urlEmail);

  const orderQuery = useQuery({
    queryKey: ["track-order", slug, urlNumber, urlEmail],
    queryFn: () =>
      publicApiClient.get<TrackedOrder>(
        `/public/${slug}/orders/${encodeURIComponent(urlNumber)}?email=${encodeURIComponent(urlEmail)}`,
      ),
    enabled: hasQuery && urlKind === "order",
    retry: false,
  });

  const bookingQuery = useQuery({
    queryKey: ["track-booking", slug, urlNumber, urlEmail],
    queryFn: () =>
      publicApiClient.get<TrackedBooking>(
        `/public/${slug}/bookings/${encodeURIComponent(urlNumber)}?email=${encodeURIComponent(urlEmail)}`,
      ),
    enabled: hasQuery && urlKind === "booking",
    retry: false,
  });

  const activeQuery = urlKind === "order" ? orderQuery : bookingQuery;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmedNumber = number.trim();
    const trimmedEmail = email.trim();
    if (!trimmedNumber || !trimmedEmail) return;

    const params = new URLSearchParams({
      kind,
      number: trimmedNumber,
      email: trimmedEmail,
    });
    router.push(`/${slug}/track?${params.toString()}`);
  }

  return (
    <div className="min-h-screen bg-app-background">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <Link href={`/${slug}`} className="text-sm text-text-muted hover:underline">
            ← Retour à la boutique
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-text">Suivre ma commande</h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-6 py-8">
        <Card className="p-4">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-3 text-sm">
              <button
                type="button"
                onClick={() => setKind("order")}
                className={kind === "order" ? "font-semibold text-text underline" : "text-text-muted"}
              >
                Commande
              </button>
              <button
                type="button"
                onClick={() => setKind("booking")}
                className={kind === "booking" ? "font-semibold text-text underline" : "text-text-muted"}
              >
                Réservation
              </button>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-text-muted">
                {kind === "order" ? "Numéro de commande" : "Numéro de réservation"}
              </span>
              <input
                required
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                placeholder={kind === "order" ? "CMD-000123" : "Identifiant de réservation"}
                className="w-full rounded-md border border-border-input px-3 py-2 text-sm text-text focus:border-focus focus:outline-none"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-text-muted">
                Email utilisé lors de la {kind === "order" ? "commande" : "réservation"}
              </span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="vous@example.com"
                className="w-full rounded-md border border-border-input px-3 py-2 text-sm text-text focus:border-focus focus:outline-none"
              />
            </label>

            <Button type="submit" className="w-full">
              Rechercher
            </Button>
          </form>
        </Card>

        {hasQuery && activeQuery.isLoading && (
          <Card className="p-6 text-center text-sm text-text-muted">Recherche en cours…</Card>
        )}

        {/* Deliberately one generic message regardless of the underlying reason (wrong number,
            wrong email, wrong organization) — never hint at which part was wrong. */}
        {hasQuery && activeQuery.isError && (
          <Card className="p-4 text-sm text-destructive">
            Aucun résultat pour ce numéro et cet email. Vérifiez ces informations et réessayez.
          </Card>
        )}

        {hasQuery && urlKind === "order" && orderQuery.isSuccess && (
          <OrderResult order={orderQuery.data} />
        )}

        {hasQuery && urlKind === "booking" && bookingQuery.isSuccess && (
          <BookingResult booking={bookingQuery.data} />
        )}
      </main>
    </div>
  );
}

function OrderResult({ order }: { order: TrackedOrder }) {
  const currentStepIndex = ORDER_STEPS.findIndex((step) => step.status === order.status);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-text">Commande {order.number}</h2>
        {order.status === "cancelled" ? (
          <Badge variant="destructive">Annulée</Badge>
        ) : (
          <Badge variant={order.status === "fulfilled" ? "success" : "default"}>
            {ORDER_STEPS[Math.max(currentStepIndex, 0)]?.label ?? order.status}
          </Badge>
        )}
      </div>

      {order.status !== "cancelled" && (
        <ol className="flex items-center gap-2">
          {ORDER_STEPS.map((step, index) => {
            const reached = currentStepIndex >= index;
            return (
              <li key={step.status} className="flex flex-1 items-center gap-2">
                <span
                  className={`h-2 flex-1 rounded-full ${reached ? "bg-zinc-900" : "bg-surface-muted"}`}
                  aria-hidden
                />
                <span className="sr-only">{step.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      <ul className="divide-y divide-border">
        {order.items.map((item, index) => (
          <li key={index} className="flex items-center justify-between py-2 text-sm">
            <span className="text-text">
              {item.description} × {item.quantity}
            </span>
            <span className="text-text-muted">
              {formatOfferPrice(item.unitPrice * item.quantity, order.currency)}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between border-t border-border pt-3 font-medium text-text">
        <span>Total</span>
        <span>{formatOfferPrice(order.total, order.currency)}</span>
      </div>
    </Card>
  );
}

function BookingResult({ booking }: { booking: TrackedBooking }) {
  const formatter = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-text">Réservation</h2>
        <Badge
          variant={
            booking.status === "cancelled"
              ? "destructive"
              : booking.status === "completed"
                ? "success"
                : "default"
          }
        >
          {BOOKING_STATUS_LABELS[booking.status]}
        </Badge>
      </div>
      <p className="text-sm text-text-muted">
        {formatter.format(new Date(booking.startAt))} — {formatter.format(new Date(booking.endAt))}
      </p>
      <div className="flex items-center justify-between border-t border-border pt-3 font-medium text-text">
        <span>Montant</span>
        <span>{formatOfferPrice(booking.pricing.amount, booking.pricing.currency)}</span>
      </div>
    </Card>
  );
}
