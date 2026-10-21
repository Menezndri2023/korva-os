"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Review, ReviewEntity } from "@korva/types";
import { Badge, Card, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const ENTITY_LABELS: Record<ReviewEntity, string> = {
  order: "Commande",
  booking: "Réservation",
};

function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} sur 5`} className="text-yellow-500">
      {"★".repeat(rating)}
      <span className="text-text-muted">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

export default function ReviewsPage() {
  const [page, setPage] = useState(1);
  const authReady = useAuthReady();

  const {
    data: reviewsPage,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["reviews", page],
    queryFn: () => apiClient.getList<Review>(`/reviews?page=${page}`),
    enabled: authReady,
  });
  const reviews = reviewsPage?.data;

  const isPermissionDenied = error instanceof ApiError && error.code === "PERMISSION_DENIED";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-text">Avis clients</h1>
        <p className="mt-1 text-sm text-text-muted">
          Notes et commentaires laissés par vos clients sur leurs commandes et réservations
          terminées, depuis leur espace client.
        </p>
      </div>

      {isLoading && <Card className="p-6 text-center text-sm text-text-muted">Chargement…</Card>}

      {isError && !isPermissionDenied && (
        <Card className="p-6">
          <p className="text-sm text-destructive">Impossible de charger les avis.</p>
          <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-text underline">
            Réessayer
          </button>
        </Card>
      )}

      {isPermissionDenied && (
        <Card className="p-6 text-sm text-text-muted">
          Les avis clients sont réservés aux rôles ayant accès aux commandes.
        </Card>
      )}

      {reviews && reviews.length === 0 && (
        <Card className="p-6 text-center text-sm text-text-muted">
          Aucun avis pour le moment.
        </Card>
      )}

      {reviews && reviews.length > 0 && (
        <div className="space-y-3">
          {reviews.map((review) => (
            <Card key={review.id} className="space-y-2 p-4">
              <div className="flex items-center justify-between">
                <Stars rating={review.rating} />
                <Badge>{ENTITY_LABELS[review.entity]}</Badge>
              </div>
              {review.comment && <p className="text-sm text-text">{review.comment}</p>}
              <p className="text-xs text-text-muted">
                {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
                  new Date(review.createdAt),
                )}
              </p>
            </Card>
          ))}
        </div>
      )}

      {reviewsPage && reviewsPage.pagination.totalPages > 1 && (
        <Pagination
          page={reviewsPage.pagination.page}
          totalPages={reviewsPage.pagination.totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
