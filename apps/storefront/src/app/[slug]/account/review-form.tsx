"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Card } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { useCustomerAuth } from "@/lib/use-customer-auth";

/**
 * Shared "Laisser un avis" widget for a fulfilled order or a completed booking — the server
 * (CustomerAuthService#createReview) is the real source of truth on eligibility and the
 * one-review-per-entity rule; this component just submits and surfaces whatever it says,
 * including a friendly message for the already-reviewed case (409 REVIEW_ALREADY_EXISTS)
 * rather than treating it as a generic error.
 */
export function ReviewForm({
  slug,
  entity,
  entityId,
}: {
  slug: string;
  entity: "order" | "booking";
  entityId: string;
}) {
  const { authFetch } = useCustomerAuth(slug);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const reviewMutation = useMutation({
    mutationFn: () =>
      authFetch((token) =>
        publicApiClient.post(
          `/public/${slug}/account/reviews`,
          { entity, entityId, rating, comment: comment.trim() || undefined },
          token,
        ),
      ),
  });

  const alreadyReviewed =
    reviewMutation.isError &&
    reviewMutation.error instanceof PublicApiError &&
    reviewMutation.error.code === "REVIEW_ALREADY_EXISTS";

  if (reviewMutation.isSuccess) {
    return (
      <Card className="p-4 text-sm text-text">
        Merci pour votre avis !
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-medium text-text">Laisser un avis</p>
      {alreadyReviewed ? (
        <p className="text-sm text-text-muted">Vous avez déjà laissé un avis pour cet élément.</p>
      ) : (
        <>
          <div className="flex gap-1" role="radiogroup" aria-label="Note">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value} étoile${value > 1 ? "s" : ""}`}
                onClick={() => setRating(value)}
                className={`text-2xl leading-none ${value <= rating ? "text-yellow-500" : "text-zinc-300"}`}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Votre commentaire (optionnel)"
            rows={3}
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm text-text focus:border-focus focus:outline-none"
          />
          {reviewMutation.isError && !alreadyReviewed && (
            <p className="text-xs text-destructive">
              {reviewMutation.error instanceof PublicApiError
                ? reviewMutation.error.message
                : "Impossible d'envoyer votre avis."}
            </p>
          )}
          <Button
            type="button"
            size="sm"
            loading={reviewMutation.isPending}
            onClick={() => reviewMutation.mutate()}
          >
            Envoyer
          </Button>
        </>
      )}
    </Card>
  );
}
