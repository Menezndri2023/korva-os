"use client";

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlatformReviewAdminRow, PlatformReviewStats, PlatformReviewStatus } from "@korva/types";
import { Badge, Button, Card, EmptyState, Input, PageHeader } from "@korva/ui";
import { ApiError } from "@/lib/api-client";
import { adminApi, formatDay } from "@/lib/platform-admin";

type Filter = PlatformReviewStatus | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "pending", label: "À relire" },
  { key: "published", label: "Publiés" },
  { key: "rejected", label: "Non publiés" },
  { key: "all", label: "Tous" },
];

const STATUS_BADGE: Record<PlatformReviewStatus, { label: string; variant: "default" | "success" | "warning" }> = {
  pending: { label: "À relire", variant: "default" },
  published: { label: "Publié", variant: "success" },
  rejected: { label: "Non publié", variant: "warning" },
};

function Stars({ rating }: { rating: number }) {
  const full = Math.round(rating);
  return (
    <span role="img" aria-label={`${full} sur 5`} className="text-amber-500">
      {"★".repeat(full)}
      <span className="text-border">{"★".repeat(5 - full)}</span>
    </span>
  );
}

/**
 * What the businesses think of KORVA OS. Every review is read here; only those whose author
 * agreed AND that an administrator published appear on korvasuite.com. The API refuses to
 * publish without the author's agreement, whatever this page shows.
 */
export default function AdminReviewsPage() {
  const [filter, setFilter] = useState<Filter>("pending");
  const queryClient = useQueryClient();

  const stats = useQuery({
    queryKey: ["platform", "reviews", "stats"],
    queryFn: () => adminApi.get<PlatformReviewStats>("/platform/reviews/stats"),
  });
  const list = useQuery({
    queryKey: ["platform", "reviews", filter],
    queryFn: () =>
      adminApi.get<PlatformReviewAdminRow[]>(
        `/platform/reviews${filter === "all" ? "" : `?status=${filter}`}`,
      ),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform", "reviews"] });
  const counts = stats.data;

  return (
    <div>
      <PageHeader
        title="Avis sur KORVA"
        description="Ce que les entreprises pensent de KORVA OS. Publiez ceux que leurs auteurs acceptent de montrer sur korvasuite.com."
      />

      {counts && (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs text-text-muted">Note moyenne</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">
              {counts.average != null
                ? counts.average.toLocaleString("fr-FR", { minimumFractionDigits: 1 })
                : "—"}
              <span className="text-sm font-normal text-text-muted"> / 5</span>
            </p>
            <p className="text-xs text-text-muted">sur {counts.count} avis (hors non publiés)</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-text-muted">À relire</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{counts.pending}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-text-muted">Publiés</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{counts.published}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-text-muted">Répartition</p>
            <p className="mt-1 text-xs leading-5 text-text-muted tabular-nums">
              {[5, 4, 3, 2, 1].map((star) => `${star}★ ${counts.distribution[star - 1]}`).join("  ")}
            </p>
          </Card>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrer les avis">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
              filter === key
                ? "border-action bg-action font-semibold text-on-action"
                : "border-border-input bg-surface hover:bg-surface-muted"
            }`}
          >
            {label}
            {key === "pending" && counts ? ` (${counts.pending})` : ""}
          </button>
        ))}
      </div>

      {list.isLoading && <Card className="p-6 text-sm text-text-muted">Chargement…</Card>}
      {list.isError && <Card className="p-6 text-sm text-destructive">Impossible de charger les avis.</Card>}
      {list.data && list.data.length === 0 && (
        <Card>
          <EmptyState
            title={filter === "pending" ? "Rien à relire." : "Aucun avis ici."}
            description="Les entreprises écrivent leur avis depuis leur tableau de bord (Votre avis sur KORVA)."
          />
        </Card>
      )}

      <div className="space-y-3">
        {list.data?.map((review) => (
          <ReviewRow key={review.id} review={review} onChanged={refresh} />
        ))}
      </div>
    </div>
  );
}

function ReviewRow({ review, onChanged }: { review: PlatformReviewAdminRow; onChanged: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const moderate = useMutation({
    mutationFn: (input: { status: "published" | "rejected"; reason?: string }) =>
      adminApi.post(`/platform/reviews/${review.id}/moderate`, input),
    onSuccess: () => {
      setRejecting(false);
      onChanged();
    },
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stars rating={review.rating} />
          <span className="text-xs text-text-muted">{formatDay(review.updatedAt)}</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={STATUS_BADGE[review.status].variant}>{STATUS_BADGE[review.status].label}</Badge>
          {review.publicConsent ? (
            <Badge variant="accent">Accepte l&apos;affichage public</Badge>
          ) : (
            <Badge>Réservé à l&apos;équipe</Badge>
          )}
        </div>
      </div>
      <p className="whitespace-pre-line text-sm text-text">{review.comment}</p>
      <p className="text-xs text-text-muted">
        {review.displayName} ·{" "}
        <Link href={`/admin/entreprises/${review.organizationId}`} className="hover:underline">
          {review.businessName}
        </Link>
        {review.authorEmail ? ` · ${review.authorEmail}` : ""}
      </p>
      {review.status === "rejected" && review.rejectionReason && (
        <p className="text-xs text-text-muted">Message envoyé : {review.rejectionReason}</p>
      )}

      {moderate.isError && (
        <p className="text-sm text-destructive">
          {moderate.error instanceof ApiError && moderate.error.code === "REVIEW_NOT_CONSENTED"
            ? "L'auteur n'a pas accepté l'affichage public : cet avis ne peut pas être publié."
            : "L'action n'a pas abouti. Réessayez."}
        </p>
      )}

      {rejecting ? (
        <form
          className="space-y-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            moderate.mutate({ status: "rejected", reason: reason.trim() || undefined });
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block text-text-muted">Message à l&apos;auteur (facultatif, visible sur sa page d&apos;avis)</span>
            <Input value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={moderate.isPending}>
              Ne pas publier
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Annuler
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {review.status !== "published" && (
            <Button
              type="button"
              size="sm"
              disabled={!review.publicConsent}
              title={review.publicConsent ? undefined : "L'auteur n'a pas accepté l'affichage public"}
              loading={moderate.isPending}
              onClick={() => moderate.mutate({ status: "published" })}
            >
              Publier sur korvasuite.com
            </Button>
          )}
          {review.status !== "rejected" && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setRejecting(true)}>
              {review.status === "published" ? "Retirer du site" : "Ne pas publier"}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
