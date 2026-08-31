"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, Card } from "@korva/ui";
import { downloadPdf, publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { formatOfferPrice } from "@/lib/offer-labels";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { CustomerBookingDetail } from "@/lib/public-types";
import type { BookingStatus } from "@korva/types";
import { AccountShell } from "../../account-shell";
import { ReviewForm } from "../../review-form";

const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "En attente de confirmation",
  confirmed: "Confirmée",
  completed: "Terminée",
  cancelled: "Annulée",
};

export default function BookingDetailClient({
  slug,
  bookingId,
}: {
  slug: string;
  bookingId: string;
}) {
  const router = useRouter();
  const { hydrated, isAuthenticated, authFetch } = useCustomerAuth(slug);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      router.replace(`/${slug}/account/login`);
    }
  }, [hydrated, isAuthenticated, slug, router]);

  const bookingQuery = useQuery({
    queryKey: ["customer-booking", slug, bookingId],
    queryFn: () =>
      authFetch((token) =>
        publicApiClient.get<CustomerBookingDetail>(
          `/public/${slug}/account/bookings/${bookingId}`,
          token,
        ),
      ),
    enabled: hydrated && isAuthenticated,
  });

  const formatter = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short" });

  async function handleDownloadCertificate() {
    setDownloadError(null);
    setDownloading(true);
    try {
      await authFetch((token) =>
        downloadPdf(
          `/public/${slug}/account/bookings/${bookingId}/certificate`,
          token,
          `certificat-${bookingId}.pdf`,
        ),
      );
    } catch (error) {
      setDownloadError(
        error instanceof PublicApiError ? error.message : "Impossible de télécharger le certificat.",
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AccountShell slug={slug} title="Ma réservation">
      <Link href={`/${slug}/account/bookings`} className="text-sm text-text-muted hover:underline">
        ← Mes réservations
      </Link>

      {bookingQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">Chargement…</Card>
      )}

      {bookingQuery.isSuccess && (
        <>
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-text">{bookingQuery.data.offerName}</h2>
              <Badge
                variant={
                  bookingQuery.data.status === "cancelled"
                    ? "destructive"
                    : bookingQuery.data.status === "completed"
                      ? "success"
                      : "default"
                }
              >
                {BOOKING_STATUS_LABELS[bookingQuery.data.status]}
              </Badge>
            </div>
            <p className="text-sm text-text-muted">
              {formatter.format(new Date(bookingQuery.data.startAt))} —{" "}
              {formatter.format(new Date(bookingQuery.data.endAt))}
            </p>
            {bookingQuery.data.notes && (
              <p className="text-sm text-text-muted">{bookingQuery.data.notes}</p>
            )}
            <div className="flex items-center justify-between border-t border-border pt-3 font-medium text-text">
              <span>Montant</span>
              <span>{formatOfferPrice(bookingQuery.data.pricing.amount, bookingQuery.data.pricing.currency)}</span>
            </div>

            {bookingQuery.data.status === "completed" && bookingQuery.data.attended && (
              <div className="border-t border-border pt-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={downloading}
                  onClick={() => void handleDownloadCertificate()}
                >
                  Télécharger le certificat
                </Button>
                {downloadError && <p className="mt-2 text-xs text-destructive">{downloadError}</p>}
              </div>
            )}
          </Card>

          {bookingQuery.data.status === "completed" && (
            <ReviewForm slug={slug} entity="booking" entityId={bookingId} />
          )}
        </>
      )}
    </AccountShell>
  );
}
