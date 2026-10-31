"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Review, ReviewEntity, ReviewStats, ReviewStatus } from "@korva/types";
import { Badge, Button, Card, EmptyState, PageHeader, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const ENTITY_LABELS: Record<ReviewEntity, string> = {
  order: "Commande",
  booking: "Réservation",
};

type Filter = "all" | ReviewStatus;
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "published", label: "En ligne" },
  { key: "hidden", label: "Masqués" },
];

const dateFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" });

function Stars({ rating, className = "" }: { rating: number; className?: string }) {
  const full = Math.round(rating);
  return (
    <span role="img" aria-label={`${full} sur 5`} className={`text-amber-500 ${className}`}>
      {"★".repeat(full)}
      <span className="text-border">{"★".repeat(5 - full)}</span>
    </span>
  );
}

/**
 * What customers say about the business, from the link they receive once an order is delivered
 * or a booking completed (or from their customer account). The owner reads everything, answers
 * publicly, and can take a review off the site — never edit it.
 */
export default function ReviewsPage() {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>("all");
  const authReady = useAuthReady();
  const queryClient = useQueryClient();

  const reviewsQuery = useQuery({
    queryKey: ["reviews", filter, page],
    queryFn: () =>
      apiClient.getList<Review>(
        `/reviews?page=${page}${filter === "all" ? "" : `&status=${filter}`}`,
      ),
    enabled: authReady,
  });
  const statsQuery = useQuery({
    queryKey: ["reviews", "stats"],
    queryFn: () => apiClient.get<ReviewStats>("/reviews/stats"),
    enabled: authReady,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["reviews"] });

  const requestsMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      apiClient.patch("/organizations/me", { reviewRequestsEnabled: enabled }),
    onSuccess: () => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ["organizations", "me"] });
    },
  });

  const { error, isLoading, isError, refetch } = reviewsQuery;
  const reviews = reviewsQuery.data?.data;
  const stats = statsQuery.data;
  const isPermissionDenied = error instanceof ApiError && error.code === "PERMISSION_DENIED";

  return (
    <div className="space-y-5">
      <PageHeader
        title="Avis clients"
        description="Ce que vos clients pensent de vous, après une commande livrée ou un rendez-vous terminé. Les avis en ligne s'affichent sur votre site."
      />

      {stats && stats.count > 0 && <StatsCard stats={stats} />}

      {stats && (
        <Card className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="max-w-xl">
            <p className="font-medium text-text">Demander un avis automatiquement</p>
            <p className="mt-1 text-sm text-text-muted">
              Après chaque commande livrée ou rendez-vous terminé, votre client reçoit un message
              (WhatsApp, sinon e-mail) avec un lien pour vous noter. Pas de compte à créer : il
              note en 30 secondes.
            </p>
            {requestsMutation.isError && (
              <p className="mt-2 text-sm text-destructive">
                {requestsMutation.error instanceof ApiError &&
                requestsMutation.error.code === "PERMISSION_DENIED"
                  ? "Seuls les rôles qui gèrent les paramètres peuvent changer ce réglage."
                  : "Le réglage n'a pas pu être enregistré. Réessayez."}
              </p>
            )}
          </div>
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-text">
            <input
              type="checkbox"
              role="switch"
              className="peer sr-only"
              checked={stats.requestsEnabled}
              disabled={requestsMutation.isPending}
              onChange={(event) => requestsMutation.mutate(event.target.checked)}
            />
            <span
              aria-hidden
              className="relative h-6 w-11 rounded-full bg-border transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-action peer-checked:after:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus"
            />
            {stats.requestsEnabled ? "Activé" : "Désactivé"}
          </label>
        </Card>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les avis">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => {
              setFilter(key);
              setPage(1);
            }}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              filter === key
                ? "border-action bg-action font-semibold text-on-action"
                : "border-border-input bg-surface hover:bg-surface-muted"
            }`}
          >
            {label}
            {key === "hidden" && stats ? ` (${stats.hidden})` : ""}
          </button>
        ))}
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
        <Card>
          <EmptyState
            title={filter === "hidden" ? "Aucun avis masqué." : "Aucun avis pour le moment."}
            description={
              filter === "all"
                ? "Les avis arrivent après vos premières commandes livrées ou vos premiers rendez-vous terminés."
                : undefined
            }
          />
        </Card>
      )}

      {reviews && reviews.length > 0 && (
        <div className="space-y-3">
          {reviews.map((review) => (
            <ReviewCard key={review.id} review={review} onChanged={refresh} />
          ))}
        </div>
      )}

      {reviewsQuery.data && reviewsQuery.data.pagination.totalPages > 1 && (
        <Pagination
          page={reviewsQuery.data.pagination.page}
          totalPages={reviewsQuery.data.pagination.totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}

function StatsCard({ stats }: { stats: ReviewStats }) {
  const max = Math.max(...stats.distribution, 1);
  return (
    <Card className="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
      <div>
        <p className="text-4xl font-semibold text-text tabular-nums">
          {stats.average?.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          <span className="text-base font-normal text-text-muted"> / 5</span>
        </p>
        {stats.average != null && <Stars rating={stats.average} className="text-lg" />}
        <p className="text-sm text-text-muted">
          {stats.count} avis{stats.hidden > 0 ? `, dont ${stats.hidden} masqué${stats.hidden > 1 ? "s" : ""}` : ""}
        </p>
      </div>
      <ul className="space-y-1.5" aria-label="Répartition des notes">
        {[5, 4, 3, 2, 1].map((star) => {
          const count = stats.distribution[star - 1] ?? 0;
          return (
            <li key={star} className="grid grid-cols-[3rem_1fr_2.5rem] items-center gap-2 text-sm">
              <span className="text-text-muted">{star} ★</span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <span
                  className="block h-full rounded-full bg-amber-500"
                  style={{ width: `${(count / max) * 100}%` }}
                />
              </span>
              <span className="text-right tabular-nums text-text-muted">{count}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ReviewCard({ review, onChanged }: { review: Review; onChanged: () => void }) {
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState(review.reply?.body ?? "");
  const hidden = review.status === "hidden";

  const statusMutation = useMutation({
    mutationFn: (status: ReviewStatus) => apiClient.patch(`/reviews/${review.id}/status`, { status }),
    onSuccess: onChanged,
  });
  const replyMutation = useMutation({
    mutationFn: (body: string) => apiClient.patch(`/reviews/${review.id}/reply`, { body }),
    onSuccess: () => {
      setReplying(false);
      onChanged();
    },
  });
  const failure = statusMutation.error ?? replyMutation.error;

  return (
    <Card className={`space-y-3 p-4 ${hidden ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stars rating={review.rating} />
          <span className="text-xs text-text-muted">{dateFormat.format(new Date(review.createdAt))}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {hidden && <Badge variant="warning">Masqué du site</Badge>}
          <Badge>{ENTITY_LABELS[review.entity]}</Badge>
        </div>
      </div>

      {review.comment ? (
        <p className="text-sm text-text">{review.comment}</p>
      ) : (
        <p className="text-sm italic text-text-muted">Note sans commentaire.</p>
      )}
      <p className="text-xs text-text-muted">
        {review.authorName ?? "Client vérifié"}
        {review.offerName ? ` · ${review.offerName}` : ""}
      </p>

      {review.reply && !replying && (
        <div className="rounded-lg border-l-2 border-primary bg-surface-muted px-3 py-2">
          <p className="text-xs font-medium text-text">Votre réponse</p>
          <p className="mt-0.5 text-sm text-text-muted">{review.reply.body}</p>
        </div>
      )}

      {replying && (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            replyMutation.mutate(draft.trim());
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block text-text-muted">Réponse publique, visible sous l&apos;avis</span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={1000}
              rows={3}
              autoFocus
              className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text focus:border-focus focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={replyMutation.isPending} disabled={!draft.trim()}>
              Publier la réponse
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setReplying(false)}>
              Annuler
            </Button>
          </div>
        </form>
      )}

      {failure && (
        <p className="text-sm text-destructive">
          {failure instanceof ApiError && failure.code === "PERMISSION_DENIED"
            ? "Votre rôle ne permet pas de modifier les avis."
            : "L'action n'a pas abouti. Réessayez."}
        </p>
      )}

      {!replying && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button type="button" size="sm" variant="secondary" onClick={() => setReplying(true)}>
            {review.reply ? "Modifier la réponse" : "Répondre"}
          </Button>
          {review.reply && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              loading={replyMutation.isPending}
              onClick={() => {
                setDraft("");
                replyMutation.mutate("");
              }}
            >
              Retirer la réponse
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={statusMutation.isPending}
            onClick={() => statusMutation.mutate(hidden ? "published" : "hidden")}
          >
            {hidden ? "Remettre en ligne" : "Masquer du site"}
          </Button>
        </div>
      )}
    </Card>
  );
}
