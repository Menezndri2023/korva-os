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
import { intlLocale, useStorefrontLocale, useT } from "@/lib/storefront-locale";

type TrackKind = "order" | "booking";

const ORDER_STEPS: { status: OrderStatus; label: [string, string] }[] = [
  { status: "pending", label: ["Reçue", "Received"] },
  { status: "confirmed", label: ["Confirmée", "Confirmed"] },
  { status: "fulfilled", label: ["Terminée", "Completed"] },
];

const BOOKING_STATUS_LABELS: Record<BookingStatus, [string, string]> = {
  pending: ["En attente de confirmation", "Awaiting confirmation"],
  confirmed: ["Confirmée", "Confirmed"],
  completed: ["Terminée", "Completed"],
  cancelled: ["Annulée", "Cancelled"],
};

/**
 * Customer-facing order/booking tracking. Every load re-queries GET /public/:slug/orders|bookings
 * for real, current data — the looked-up number+email live in the URL query string (not just
 * component state), so a bookmark, a shared link, or a plain page refresh all re-run the same
 * real lookup instead of showing stale or fabricated state.
 */
export default function TrackClient({ slug }: { slug: string }) {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlKind: TrackKind = searchParams.get("kind") === "booking" ? "booking" : "order";
  const urlNumber = searchParams.get("number") ?? "";
  const urlEmail = searchParams.get("email") ?? "";
  const hasQuery = urlNumber.trim().length > 0 && urlEmail.trim().length > 0;
  // Set by the return address of an online payment (PublicService#payOrder).
  const backFromPayment = searchParams.get("paid") === "1";

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
    // Back from the payment page, GeniusPay may confirm a few seconds later: ask again until it
    // does, for two minutes at most.
    refetchInterval: (query) =>
      backFromPayment && query.state.data?.payment?.status === "pending" && query.state.dataUpdateCount < 30
        ? 4000
        : false,
  });

  const bookingQuery = useQuery({
    queryKey: ["track-booking", slug, urlNumber, urlEmail],
    queryFn: () =>
      publicApiClient.get<TrackedBooking>(
        `/public/${slug}/bookings/${encodeURIComponent(urlNumber)}?email=${encodeURIComponent(urlEmail)}`,
      ),
    enabled: hasQuery && urlKind === "booking",
    retry: false,
    refetchInterval: (query) =>
      backFromPayment && query.state.data?.deposit?.status === "pending" && query.state.dataUpdateCount < 30
        ? 4000
        : false,
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
            {t("← Retour à la boutique", "← Back to the shop")}
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-text">{t("Suivre ma commande", "Track my order")}</h1>
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
                {t("Commande", "Order")}
              </button>
              <button
                type="button"
                onClick={() => setKind("booking")}
                className={kind === "booking" ? "font-semibold text-text underline" : "text-text-muted"}
              >
                {t("Réservation", "Booking")}
              </button>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-text-muted">
                {kind === "order" ? t("Numéro de commande", "Order number") : t("Numéro de réservation", "Booking number")}
              </span>
              <input
                required
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                placeholder={kind === "order" ? "CMD-000123" : t("Identifiant de réservation", "Booking reference")}
                className="w-full rounded-md border border-border-input px-3 py-2 text-sm text-text focus:border-focus focus:outline-none"
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block text-text-muted">
                {kind === "order"
                  ? t("Email utilisé lors de la commande", "E-mail used for the order")
                  : t("Email utilisé lors de la réservation", "E-mail used for the booking")}
              </span>
              <input
                required
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("vous@example.com", "you@example.com")}
                className="w-full rounded-md border border-border-input px-3 py-2 text-sm text-text focus:border-focus focus:outline-none"
              />
            </label>

            <Button type="submit" className="w-full">
              {t("Rechercher", "Search")}
            </Button>
          </form>
        </Card>

        {hasQuery && activeQuery.isLoading && (
          <Card className="p-6 text-center text-sm text-text-muted">{t("Recherche en cours…", "Searching…")}</Card>
        )}

        {/* Deliberately one generic message regardless of the underlying reason (wrong number,
            wrong email, wrong organization) — never hint at which part was wrong. */}
        {hasQuery && activeQuery.isError && (
          <Card className="p-4 text-sm text-destructive">
            {t(
              "Aucun résultat pour ce numéro et cet email. Vérifiez ces informations et réessayez.",
              "No result for this number and e-mail. Check them and try again.",
            )}
          </Card>
        )}

        {hasQuery && urlKind === "order" && orderQuery.isSuccess && orderQuery.data.payment && (
          <PaymentState status={orderQuery.data.payment.status} backFromPayment={backFromPayment} />
        )}

        {hasQuery && urlKind === "order" && orderQuery.isSuccess && (
          <OrderResult order={orderQuery.data} />
        )}

        {hasQuery && urlKind === "booking" && bookingQuery.isSuccess && bookingQuery.data.deposit && (
          <DepositState deposit={bookingQuery.data.deposit} currency={bookingQuery.data.pricing.currency} backFromPayment={backFromPayment} />
        )}

        {hasQuery && urlKind === "booking" && bookingQuery.isSuccess && (
          <BookingResult booking={bookingQuery.data} />
        )}
      </main>
    </div>
  );
}

function PaymentState({
  status,
  backFromPayment,
}: {
  status: "paid" | "pending" | "failed";
  backFromPayment: boolean;
}) {
  const t = useT();
  if (status === "paid") {
    return (
      <Card className="border-success p-4 text-sm" role="status">
        <p className="font-medium text-text">{t("Paiement reçu, merci !", "Payment received, thank you!")}</p>
        <p className="mt-1 text-text-muted">
          {t(
            "Votre commande est payée. Gardez ce lien pour suivre sa préparation.",
            "Your order is paid. Keep this link to follow its preparation.",
          )}
        </p>
      </Card>
    );
  }
  if (status === "pending") {
    return (
      <Card className="p-4 text-sm" role="status">
        <p className="font-medium text-text">
          {backFromPayment
            ? t("Paiement en cours de confirmation…", "Confirming your payment…")
            : t("Paiement en attente", "Payment pending")}
        </p>
        <p className="mt-1 text-text-muted">
          {t(
            "Cette page se met à jour toute seule dès que le paiement est confirmé. Si vous avez annulé, rien n'a été prélevé.",
            "This page updates by itself as soon as the payment is confirmed. If you cancelled, nothing was charged.",
          )}
        </p>
      </Card>
    );
  }
  return (
    <Card className="p-4 text-sm text-destructive" role="status">
      {t(
        "Le paiement n'a pas abouti et rien n'a été prélevé. Vous pouvez repasser commande depuis la boutique, ou contacter le commerçant.",
        "The payment did not go through and nothing was charged. You can order again from the shop, or contact the business.",
      )}
    </Card>
  );
}

function OrderResult({ order }: { order: TrackedOrder }) {
  const locale = useStorefrontLocale();
  const t = useT();
  const currentStepIndex = ORDER_STEPS.findIndex((step) => step.status === order.status);

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-text">{t(`Commande ${order.number}`, `Order ${order.number}`)}</h2>
        {order.status === "cancelled" ? (
          <Badge variant="destructive">{t("Annulée", "Cancelled")}</Badge>
        ) : (
          <Badge variant={order.status === "fulfilled" ? "success" : "default"}>
            {(() => {
              const step = ORDER_STEPS[Math.max(currentStepIndex, 0)];
              return step ? t(...step.label) : order.status;
            })()}
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
                <span className="sr-only">{t(...step.label)}</span>
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
              {formatOfferPrice(item.unitPrice * item.quantity, order.currency, locale)}
            </span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-between border-t border-border pt-3 font-medium text-text">
        <span>{t("Total", "Total")}</span>
        <span>{formatOfferPrice(order.total, order.currency, locale)}</span>
      </div>
    </Card>
  );
}

function BookingResult({ booking }: { booking: TrackedBooking }) {
  const locale = useStorefrontLocale();
  const t = useT();
  const formatter = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "full",
    timeStyle: "short",
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-text">{t("Réservation", "Booking")}</h2>
        <Badge
          variant={
            booking.status === "cancelled"
              ? "destructive"
              : booking.status === "completed"
                ? "success"
                : "default"
          }
        >
          {t(...BOOKING_STATUS_LABELS[booking.status])}
        </Badge>
      </div>
      <p className="text-sm text-text-muted">
        {formatter.format(new Date(booking.startAt))} — {formatter.format(new Date(booking.endAt))}
      </p>
      <div className="flex items-center justify-between border-t border-border pt-3 font-medium text-text">
        <span>{t("Montant", "Amount")}</span>
        <span>{formatOfferPrice(booking.pricing.amount, booking.pricing.currency, locale)}</span>
      </div>
    </Card>
  );
}

function DepositState({
  deposit,
  currency,
  backFromPayment,
}: {
  deposit: NonNullable<TrackedBooking["deposit"]>;
  currency: string;
  backFromPayment: boolean;
}) {
  const t = useT();
  const locale = useStorefrontLocale();
  const amount = formatOfferPrice(deposit.amount, currency, locale);
  if (deposit.status === "paid") {
    return (
      <Card className="p-4 text-sm" role="status">
        <p className="font-medium text-text">{t("Acompte reçu, merci !", "Deposit received, thank you!")}</p>
        <p className="mt-1 text-text-muted">
          {t(`Votre acompte de ${amount} est payé : votre réservation est garantie.`, `Your ${amount} deposit is paid: your booking is secured.`)}
        </p>
      </Card>
    );
  }
  if (deposit.status === "pending") {
    return (
      <Card className="p-4 text-sm" role="status">
        <p className="font-medium text-text">
          {backFromPayment
            ? t("Acompte en cours de confirmation…", "Confirming your deposit…")
            : t(`Acompte de ${amount} en attente`, `${amount} deposit pending`)}
        </p>
        <p className="mt-1 text-text-muted">
          {t(
            "Cette page se met à jour toute seule. Sans paiement dans l'heure qui suit la réservation, le créneau est libéré.",
            "This page updates by itself. Unpaid within the hour after booking, the slot is released.",
          )}
        </p>
      </Card>
    );
  }
  return (
    <Card className="p-4 text-sm text-destructive" role="status">
      {t(
        "Le paiement de l'acompte n'a pas abouti et rien n'a été prélevé. Réservez à nouveau depuis le site, ou contactez l'établissement.",
        "The deposit payment did not go through and nothing was charged. Book again from the site, or contact the business.",
      )}
    </Card>
  );
}
