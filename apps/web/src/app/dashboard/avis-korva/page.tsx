"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlatformReview } from "@korva/types";
import { Badge, Button, Card, Notice, PageHeader } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const LABELS = ["Décevant", "Moyen", "Bien", "Très bien", "Excellent"] as const;

const STATUS: Record<PlatformReview["status"], { label: string; variant: "default" | "success" | "warning" }> = {
  pending: { label: "En relecture", variant: "default" },
  published: { label: "Publié sur korvasuite.com", variant: "success" },
  rejected: { label: "Non publié", variant: "warning" },
};

/**
 * A business tells KORVA what it thinks of the product. The team reads every review; with the
 * author's agreement, the administration can show it on korvasuite.com (first name + business
 * name). Saving again sends it back for reading.
 */
export default function KorvaReviewPage() {
  const authReady = useAuthReady();
  const queryClient = useQueryClient();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [publicConsent, setPublicConsent] = useState(true);
  const [missingRating, setMissingRating] = useState(false);
  const [editing, setEditing] = useState(false);

  const mine = useQuery({
    queryKey: ["platform-review", "me"],
    queryFn: () => apiClient.get<PlatformReview | null>("/platform-reviews/me"),
    enabled: authReady,
  });

  // Fill the form once with what was saved, so editing starts from it.
  useEffect(() => {
    if (!mine.data) return;
    /* eslint-disable react-hooks/set-state-in-effect -- one-time copy of the server's value into the form */
    setRating(mine.data.rating);
    setComment(mine.data.comment);
    setPublicConsent(mine.data.publicConsent);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [mine.data]);

  const save = useMutation({
    mutationFn: () =>
      apiClient.patch<PlatformReview>("/platform-reviews/me", {
        rating,
        comment: comment.trim(),
        publicConsent,
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["platform-review", "me"], saved);
      setEditing(false);
    },
  });

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (rating === 0) {
      setMissingRating(true);
      return;
    }
    save.mutate();
  }

  const review = mine.data;
  const showForm = !review || editing;

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="Votre avis sur KORVA"
        description="Ce qui vous aide, ce qui vous manque : l'équipe lit chaque avis et s'en sert pour choisir ce qu'elle construit ensuite."
      />

      {mine.isLoading && <Card className="p-6 text-sm text-text-muted">Chargement…</Card>}
      {mine.isError && (
        <Card className="p-6 text-sm text-destructive">Impossible de charger votre avis. Réessayez.</Card>
      )}

      {review && !editing && (
        <Card className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span role="img" aria-label={`${review.rating} sur 5`} className="text-xl text-amber-500">
              {"★".repeat(review.rating)}
              <span className="text-border">{"★".repeat(5 - review.rating)}</span>
            </span>
            <Badge variant={STATUS[review.status].variant}>{STATUS[review.status].label}</Badge>
          </div>
          <p className="whitespace-pre-line text-sm text-text">{review.comment}</p>
          <p className="text-xs text-text-muted">
            {review.publicConsent
              ? `Peut être affiché sur korvasuite.com au nom de « ${review.displayName}, ${review.businessName} ».`
              : "Réservé à l'équipe KORVA : il ne sera jamais affiché publiquement."}
          </p>
          {review.status === "rejected" && review.rejectionReason && (
            <Notice tone="warning">Message de l&apos;équipe : {review.rejectionReason}</Notice>
          )}
          <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
            Modifier mon avis
          </Button>
        </Card>
      )}

      {!mine.isLoading && !mine.isError && showForm && (
        <Card className="p-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            <fieldset>
              <legend className="text-sm font-medium text-text">Votre note</legend>
              <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Votre note">
                {LABELS.map((label, index) => {
                  const star = index + 1;
                  return (
                    <button
                      key={star}
                      type="button"
                      role="radio"
                      aria-checked={rating === star}
                      aria-label={`${star} sur 5 — ${label}`}
                      onClick={() => {
                        setRating(star);
                        setMissingRating(false);
                      }}
                      className={`rounded-md px-0.5 text-4xl leading-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                        star <= rating ? "text-amber-500" : "text-border"
                      }`}
                    >
                      ★
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 h-5 text-sm text-text-muted" aria-live="polite">
                {rating > 0 ? LABELS[rating - 1] : ""}
              </p>
              {missingRating && (
                <p className="text-sm text-destructive" role="alert">
                  Choisissez une note de 1 à 5 étoiles.
                </p>
              )}
            </fieldset>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-text">Votre avis</span>
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                required
                minLength={10}
                maxLength={1000}
                rows={5}
                placeholder="Ce que KORVA a changé pour votre activité, ce qui vous manque encore…"
                className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text focus:border-focus focus:outline-none"
              />
              <span className="mt-1 block text-xs text-text-muted">{comment.trim().length} / 1000</span>
            </label>

            <label className="flex items-start gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={publicConsent}
                onChange={(event) => setPublicConsent(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                J&apos;accepte que cet avis soit affiché sur korvasuite.com avec mon prénom et le nom
                de mon entreprise.
                <span className="block text-xs text-text-muted">
                  Décochez pour le réserver à l&apos;équipe KORVA.
                </span>
              </span>
            </label>

            {save.isError && (
              <p className="text-sm text-destructive" role="alert">
                {save.error instanceof ApiError && save.error.code === "VALIDATION_ERROR"
                  ? "Écrivez au moins 10 caractères."
                  : "Votre avis n'a pas pu être enregistré. Réessayez."}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={save.isPending}>
                {review ? "Enregistrer" : "Envoyer mon avis"}
              </Button>
              {review && (
                <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                  Annuler
                </Button>
              )}
            </div>
            {review?.status === "published" && (
              <p className="text-xs text-text-muted">
                Une fois modifié, votre avis est relu avant de réapparaître sur korvasuite.com.
              </p>
            )}
          </form>
        </Card>
      )}

      {save.isSuccess && !editing && (
        <Notice tone="accent">Merci ! L&apos;équipe KORVA a bien reçu votre avis.</Notice>
      )}
    </div>
  );
}
