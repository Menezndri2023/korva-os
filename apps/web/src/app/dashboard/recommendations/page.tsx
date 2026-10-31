"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionCenterSeverity, Recommendation, RecommendationStatus } from "@korva/types";
import { Badge, Button, Card, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

const STATUS_LABELS: Record<RecommendationStatus, string> = {
  open: "À traiter",
  dismissed: "Ignorée",
  resolved: "Résolue",
};

const SEVERITY_LABELS: Record<ActionCenterSeverity, string> = {
  urgent: "Urgent",
  attention: "À surveiller",
  opportunity: "Opportunité",
  recommendation: "Recommandation",
};

const SEVERITY_BADGE_VARIANTS: Record<
  ActionCenterSeverity,
  "default" | "success" | "warning" | "destructive"
> = {
  urgent: "destructive",
  attention: "warning",
  opportunity: "success",
  recommendation: "default",
};

const STATUS_FILTERS: { value: RecommendationStatus | "all"; label: string }[] = [
  { value: "open", label: "À traiter" },
  { value: "resolved", label: "Résolues" },
  { value: "dismissed", label: "Ignorées" },
  { value: "all", label: "Toutes" },
];

export default function RecommendationsPage() {
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<RecommendationStatus | "all">("open");

  const {
    data: recommendationsPage,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["recommendations", status, page],
    queryFn: () =>
      apiClient.getList<Recommendation>(
        `/recommendations?page=${page}${status === "all" ? "" : `&status=${status}`}`,
      ),
    enabled: authReady,
  });
  const recommendations = recommendationsPage?.data;

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ["recommendations"] });

  const dismissMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Recommendation>(`/recommendations/${id}/dismiss`),
    onSuccess: invalidate,
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.post<Recommendation>(`/recommendations/${id}/resolve`),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Recommandations</h1>
        <p className="mt-1 text-sm text-text-muted">
          Ce que KORVA a remarqué dans votre activité et recommande de traiter.
        </p>
      </div>

      <div className="flex gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            onClick={() => {
              setStatus(filter.value);
              setPage(1);
            }}
            className={`rounded-md px-3 py-1.5 text-sm ${
              status === filter.value
                ? "bg-action text-on-action"
                : "text-text-muted hover:bg-surface-muted"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">
            {error instanceof ApiError
              ? error.message
              : "Impossible de charger les recommandations."}
          </p>
          <button
            onClick={() => void refetch()}
            className="mt-2 text-sm font-medium text-text underline"
          >
            Réessayer
          </button>
        </Card>
      )}

      {!isError && (
        <Card className="divide-y divide-border overflow-hidden">
          {isLoading && (
            <p className="px-4 py-6 text-center text-sm text-text-muted">Chargement...</p>
          )}
          {!isLoading && recommendations?.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-text-muted">
              Aucune recommandation pour le moment.
            </p>
          )}
          {recommendations?.map((recommendation) => (
            <div key={recommendation.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text">{recommendation.title}</p>
                  {recommendation.severity && (
                    <Badge variant={SEVERITY_BADGE_VARIANTS[recommendation.severity]}>
                      {SEVERITY_LABELS[recommendation.severity]}
                    </Badge>
                  )}
                  <Badge>{STATUS_LABELS[recommendation.status]}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-text-muted">{recommendation.description}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                  <span>{new Date(recommendation.createdAt).toLocaleString("fr-FR")}</span>
                  {recommendation.impact && <span>· {recommendation.impact}</span>}
                </div>
              </div>
              {recommendation.status === "open" && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => resolveMutation.mutate(recommendation.id)}
                    loading={resolveMutation.isPending}
                  >
                    Résolue
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dismissMutation.mutate(recommendation.id)}
                    loading={dismissMutation.isPending}
                  >
                    Ignorer
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {!isError && (
        <Pagination
          page={page}
          totalPages={recommendationsPage?.pagination.totalPages ?? 1}
          onPageChange={setPage}
          disabled={isLoading}
        />
      )}
    </div>
  );
}
