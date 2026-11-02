"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Review, ReviewEntity, ReviewStats, ReviewStatus } from "@korva/types";
import { Badge, Button, Card, EmptyState, PageHeader, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

const ENTITY_LABELS: Record<ReviewEntity, [string, string]> = {
  order: ["Commande", "Order"],
  booking: ["Réservation", "Booking"],
};

type Filter = "all" | ReviewStatus;
const FILTERS: { key: Filter; label: [string, string] }[] = [
  { key: "all", label: ["Tous", "All"] },
  { key: "published", label: ["En ligne", "Online"] },
  { key: "hidden", label: ["Masqués", "Hidden"] },
];

function Stars({ rating, className = "" }: { rating: number; className?: string }) {
  const t = useT();
  const full = Math.round(rating);
  return (
    <span role="img" aria-label={t(`${full} sur 5`, `${full} out of 5`)} className={`text-amber-500 ${className}`}>
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
  const t = useT();
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
        title={t("Avis clients", "Customer reviews")}
        description={t(
          "Ce que vos clients pensent de vous, après une commande livrée ou un rendez-vous terminé. Les avis en ligne s'affichent sur votre site.",
          "What your customers think of you, after a fulfilled order or a completed appointment. Online reviews show on your website.",
        )}
      />

      {stats && stats.count > 0 && <StatsCard stats={stats} />}

      {stats && (
        <Card className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="max-w-xl">
            <p className="font-medium text-text">{t(
              "Demander un avis automatiquement",
              "Ask for a review automatically",
            )}</p>
            <p className="mt-1 text-sm text-text-muted">
              {t(
                "Après chaque commande livrée ou rendez-vous terminé, votre client reçoit un message (WhatsApp, sinon e-mail) avec un lien pour vous noter. Pas de compte à créer : il note en 30 secondes.",
                "After each fulfilled order or completed appointment, your customer gets a message (WhatsApp, otherwise e-mail) with a link to rate you. No account to create: it takes 30 seconds.",
              )}
            </p>
            {requestsMutation.isError && (
              <p className="mt-2 text-sm text-destructive">
                {requestsMutation.error instanceof ApiError &&
                requestsMutation.error.code === "PERMISSION_DENIED"
                  ? t(
                    "Seuls les rôles qui gèrent les paramètres peuvent changer ce réglage.",
                    "Only roles that manage settings can change this.",
                  )
                  : t(
                    "Le réglage n'a pas pu être enregistré. Réessayez.",
                    "The setting could not be saved. Try again.",
                  )}
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
            {stats.requestsEnabled ? t("Activé", "On") : t("Désactivé", "Off")}
          </label>
        </Card>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label={t("Filtrer les avis", "Filter reviews")}>
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
            {t(...label)}
            {key === "hidden" && stats ? ` (${stats.hidden})` : ""}
          </button>
        ))}
      </div>

      {isLoading && <Card className="p-6 text-center text-sm text-text-muted">{t("Chargement…", "Loading…")}</Card>}

      {isError && !isPermissionDenied && (
        <Card className="p-6">
          <p className="text-sm text-destructive">{t(
            "Impossible de charger les avis.",
            "Reviews could not be loaded.",
          )}</p>
          <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-text underline">
            {t("Réessayer", "Try again")}
          </button>
        </Card>
      )}

      {isPermissionDenied && (
        <Card className="p-6 text-sm text-text-muted">
          {t(
            "Les avis clients sont réservés aux rôles ayant accès aux commandes.",
            "Customer reviews are for roles with access to orders.",
          )}
        </Card>
      )}

      {reviews && reviews.length === 0 && (
        <Card>
          <EmptyState
            title={filter === "hidden" ? t("Aucun avis masqué.", "No hidden reviews.") : t("Aucun avis pour le moment.", "No reviews yet.")}
            description={
              filter === "all"
                ? t(
                  "Les avis arrivent après vos premières commandes livrées ou vos premiers rendez-vous terminés.",
                  "Reviews arrive after your first fulfilled orders or completed appointments.",
                )
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
  const locale = useDashboardLocale();
  const t = useT();
  const max = Math.max(...stats.distribution, 1);
  return (
    <Card className="grid gap-6 p-5 sm:grid-cols-[auto_1fr] sm:items-center">
      <div>
        <p className="text-4xl font-semibold text-text tabular-nums">
          {stats.average?.toLocaleString(intlLocale(locale), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          <span className="text-base font-normal text-text-muted"> / 5</span>
        </p>
        {stats.average != null && <Stars rating={stats.average} className="text-lg" />}
        <p className="text-sm text-text-muted">
          {t(
              `${stats.count} avis${stats.hidden > 0 ? `, dont ${stats.hidden} masqué${stats.hidden > 1 ? "s" : ""}` : ""}`,
              `${stats.count} review${stats.count === 1 ? "" : "s"}${stats.hidden > 0 ? `, ${stats.hidden} hidden` : ""}`,
            )}
        </p>
      </div>
      <ul className="space-y-1.5" aria-label={t("Répartition des notes", "Rating breakdown")}>
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
  const locale = useDashboardLocale();
  const t = useT();
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
          <span className="text-xs text-text-muted">{new Date(review.createdAt).toLocaleDateString(intlLocale(locale), { dateStyle: "medium" })}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {hidden && <Badge variant="warning">{t("Masqué du site", "Hidden from the website")}</Badge>}
          <Badge>{t(...ENTITY_LABELS[review.entity])}</Badge>
        </div>
      </div>

      {review.comment ? (
        <p className="text-sm text-text">{review.comment}</p>
      ) : (
        <p className="text-sm italic text-text-muted">{t("Note sans commentaire.", "Rating with no comment.")}</p>
      )}
      <p className="text-xs text-text-muted">
        {review.authorName ?? t("Client vérifié", "Verified customer")}
        {review.offerName ? ` · ${review.offerName}` : ""}
      </p>

      {review.reply && !replying && (
        <div className="rounded-lg border-l-2 border-primary bg-surface-muted px-3 py-2">
          <p className="text-xs font-medium text-text">{t("Votre réponse", "Your reply")}</p>
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
            <span className="mb-1 block text-text-muted">{t(
              "Réponse publique, visible sous l'avis",
              "Public reply, shown under the review",
            )}</span>
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
              {t("Publier la réponse", "Publish the reply")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setReplying(false)}>
              {t("Annuler", "Cancel")}
            </Button>
          </div>
        </form>
      )}

      {failure && (
        <p className="text-sm text-destructive">
          {failure instanceof ApiError && failure.code === "PERMISSION_DENIED"
            ? t("Votre rôle ne permet pas de modifier les avis.", "Your role cannot change reviews.")
            : t("L'action n'a pas abouti. Réessayez.", "That did not work. Try again.")}
        </p>
      )}

      {!replying && (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          <Button type="button" size="sm" variant="secondary" onClick={() => setReplying(true)}>
            {review.reply ? t("Modifier la réponse", "Edit the reply") : t("Répondre", "Reply")}
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
              {t("Retirer la réponse", "Remove the reply")}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={statusMutation.isPending}
            onClick={() => statusMutation.mutate(hidden ? "published" : "hidden")}
          >
            {hidden ? t("Remettre en ligne", "Put back online") : t("Masquer du site", "Hide from the website")}
          </Button>
        </div>
      )}
    </Card>
  );
}
