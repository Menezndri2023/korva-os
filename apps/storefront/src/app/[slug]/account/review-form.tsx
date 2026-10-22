"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Card } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import { StarPicker } from "../star-picker";

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
  const { authFetch, customer } = useCustomerAuth(slug);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [showName, setShowName] = useState(true);

  const reviewMutation = useMutation({
    mutationFn: () =>
      authFetch((token) =>
        publicApiClient.post(
          `/public/${slug}/account/reviews`,
          { entity, entityId, rating, comment: comment.trim() || undefined, showName },
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
        Merci, votre avis est publié sur le site.
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
          <StarPicker value={rating} onChange={setRating} />
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Votre commentaire (optionnel)"
            rows={3}
            className="w-full rounded-md border border-border-input px-3 py-2 text-base text-text focus:border-focus focus:outline-none"
          />
          {customer?.firstName && (
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={showName}
                onChange={(event) => setShowName(event.target.checked)}
                className="h-4 w-4"
              />
              Signer avec mon prénom ({customer.firstName}), sinon « Client vérifié »
            </label>
          )}
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
            disabled={rating === 0}
            onClick={() => reviewMutation.mutate()}
          >
            Envoyer
          </Button>
        </>
      )}
    </Card>
  );
}
