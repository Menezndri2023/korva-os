"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card } from "@korva/ui";
import { publicApiClient } from "@/lib/public-api-client";
import { formatOfferPrice } from "@/lib/offer-labels";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { CustomerBookingSummary } from "@/lib/public-types";
import { tradeVocabulary, type BookingStatus } from "@korva/types";
import { usePublicOrganization } from "@/lib/use-public-organization";
import { AccountShell } from "../account-shell";

const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "En attente de confirmation",
  confirmed: "Confirmée",
  completed: "Terminée",
  cancelled: "Annulée",
};

export default function BookingsHistoryClient({ slug }: { slug: string }) {
  // "Mes rendez-vous", "Mes visites", "Mes séjours"… — the trade's word, as in the account menu.
  const title = `Mes ${tradeVocabulary(usePublicOrganization(slug).data?.businessModel).bookings.toLowerCase()}`;
  const router = useRouter();
  const { hydrated, isAuthenticated, authFetch } = useCustomerAuth(slug);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  const bookingsQuery = useQuery({
    queryKey: ["customer-bookings", slug],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<CustomerBookingSummary[]>(`/public/${slug}/account/bookings`, token),
      ),
    enabled: hydrated && isAuthenticated,
  });

  const formatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

  return (
    <AccountShell slug={slug} title={title}>
      <Link href={`/${slug}/account`} className="text-sm text-text-muted hover:underline">
        ← Mon compte
      </Link>

      {bookingsQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">Chargement…</Card>
      )}

      {bookingsQuery.isSuccess && bookingsQuery.data.length === 0 && (
        <Card className="p-6 text-center text-sm text-text-muted">
          Vous n&apos;avez pas encore de réservation.
        </Card>
      )}

      {bookingsQuery.isSuccess && bookingsQuery.data.length > 0 && (
        <div className="space-y-3">
          {bookingsQuery.data.map((booking) => (
            <Link key={booking.id} href={`/${slug}/account/bookings/${booking.id}`}>
            <Card className="flex items-center justify-between p-4 text-sm hover:bg-surface-muted">
              <div>
                <p className="font-medium text-text">{formatter.format(new Date(booking.startAt))}</p>
                <p className="text-text-muted">
                  jusqu&apos;à {formatter.format(new Date(booking.endAt))}
                </p>
              </div>
              <div className="text-right">
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
                <p className="mt-1 font-medium text-text">
                  {formatOfferPrice(booking.pricing.amount, booking.pricing.currency)}
                </p>
              </div>
            </Card>
            </Link>
          ))}
        </div>
      )}
    </AccountShell>
  );
}
