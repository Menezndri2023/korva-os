"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card } from "@korva/ui";
import { downloadPdf, publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { formatOfferPrice } from "@/lib/offer-labels";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { CustomerBookingDetail } from "@/lib/public-types";
import type { BookingStatus } from "@korva/types";
import { AccountShell } from "../../account-shell";
import { ReviewForm } from "../../review-form";
import { intlLocale, useStorefrontLocale, useT } from "@/lib/storefront-locale";

const BOOKING_STATUS_LABELS: Record<BookingStatus, [string, string]> = {
  pending: ["En attente de confirmation", "Awaiting confirmation"],
  confirmed: ["Confirmée", "Confirmed"],
  completed: ["Terminée", "Completed"],
  cancelled: ["Annulée", "Cancelled"],
};

export default function BookingDetailClient({
  slug,
  bookingId,
}: {
  slug: string;
  bookingId: string;
}) {
  const locale = useStorefrontLocale();
  const t = useT();
  const router = useRouter();
  const { hydrated, isAuthenticated, authFetch } = useCustomerAuth(slug);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const queryClient = useQueryClient();

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

  const cancelMutation = useMutation({
    mutationFn: () =>
      authFetch((token) =>
        publicApiClient.post(`/public/${slug}/account/bookings/${bookingId}/cancel`, {}, token),
      ),
    onSuccess: () => {
      setConfirmingCancel(false);
      void queryClient.invalidateQueries({ queryKey: ["customer-booking", slug, bookingId] });
    },
  });

  const formatter = new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "full", timeStyle: "short" });

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
        error instanceof PublicApiError ? error.message : t(
          "Impossible de télécharger le certificat.",
          "The certificate could not be downloaded.",
        ),
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <AccountShell slug={slug} title={t("Ma réservation", "My booking")}>
      <Link href={`/${slug}/account/bookings`} className="text-sm text-text-muted hover:underline">
        {t("← Mes réservations", "← My bookings")}
      </Link>

      {bookingQuery.isLoading && (
        <Card className="p-6 text-center text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>
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
                {t(...BOOKING_STATUS_LABELS[bookingQuery.data.status])}
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
              <span>{t("Montant", "Amount")}</span>
              <span>{formatOfferPrice(bookingQuery.data.pricing.amount, bookingQuery.data.pricing.currency, locale)}</span>
            </div>

            {bookingQuery.data.cancellableUntil && (
              <div className="space-y-2 border-t border-border pt-3">
                <p className="text-xs text-text-muted">
                  {t(
                    `Annulation gratuite jusqu'au ${formatter.format(new Date(bookingQuery.data.cancellableUntil))}.`,
                    `Free cancellation until ${formatter.format(new Date(bookingQuery.data.cancellableUntil))}.`,
                  )}
                </p>
                {confirmingCancel ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-text">{t("Annuler cette réservation ?", "Cancel this booking?")}</span>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      loading={cancelMutation.isPending}
                      onClick={() => cancelMutation.mutate()}
                    >
                      {t("Oui, annuler", "Yes, cancel")}
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingCancel(false)}>
                      {t("Non, la garder", "No, keep it")}
                    </Button>
                  </div>
                ) : (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingCancel(true)}>
                    {t("Annuler ma réservation", "Cancel my booking")}
                  </Button>
                )}
                {cancelMutation.isError && (
                  <p className="text-xs text-destructive">
                    {cancelMutation.error instanceof PublicApiError
                      ? cancelMutation.error.message
                      : t("L'annulation n'a pas abouti.", "The cancellation failed.")}
                  </p>
                )}
              </div>
            )}
            {!bookingQuery.data.cancellableUntil &&
              bookingQuery.data.cancellationHours &&
              (bookingQuery.data.status === "pending" || bookingQuery.data.status === "confirmed") && (
                <p className="border-t border-border pt-3 text-xs text-text-muted">
                  {t(
                    `Le délai d'annulation gratuite (${bookingQuery.data.cancellationHours} h avant) est passé : pour annuler, contactez directement l'établissement.`,
                    `The free cancellation period (${bookingQuery.data.cancellationHours} h before) is over: to cancel, contact the business directly.`,
                  )}
                </p>
              )}
            {bookingQuery.data.status === "cancelled" && bookingQuery.data.cancelledBy === "customer" && (
              <p className="border-t border-border pt-3 text-xs text-text-muted">
                {t(
                  "Vous avez annulé cette réservation. Si vous aviez payé en ligne, l'établissement a été prévenu du remboursement.",
                  "You cancelled this booking. If you paid online, the business has been told to refund you.",
                )}
              </p>
            )}

            {bookingQuery.data.status === "completed" && bookingQuery.data.attended && (
              <div className="border-t border-border pt-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={downloading}
                  onClick={() => void handleDownloadCertificate()}
                >
                  {t("Télécharger le certificat", "Download the certificate")}
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
