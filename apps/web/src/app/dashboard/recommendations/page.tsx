"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ActionCenterSeverity, Recommendation, RecommendationStatus } from "@korva/types";
import { Badge, Button, Card, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

const STATUS_LABELS: Record<RecommendationStatus, [string, string]> = {
  open: ["À traiter", "To handle"],
  dismissed: ["Ignorée", "Dismissed"],
  resolved: ["Résolue", "Resolved"],
};

const SEVERITY_LABELS: Record<ActionCenterSeverity, [string, string]> = {
  urgent: ["Urgent", "Urgent"],
  attention: ["À surveiller", "To watch"],
  opportunity: ["Opportunité", "Opportunity"],
  recommendation: ["Recommandation", "Recommendation"],
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

const STATUS_FILTERS: { value: RecommendationStatus | "all"; label: [string, string] }[] = [
  { value: "open", label: ["À traiter", "To handle"] },
  { value: "resolved", label: ["Résolues", "Resolved"] },
  { value: "dismissed", label: ["Ignorées", "Dismissed"] },
  { value: "all", label: ["Toutes", "All"] },
];

export default function RecommendationsPage() {
  const locale = useDashboardLocale();
  const t = useT();
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
        <h1 className="text-2xl font-semibold">{t("Recommandations", "Recommendations")}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {t(
            "Ce que KORVA a remarqué dans votre activité et recommande de traiter.",
            "What KORVA has noticed in your business and recommends you deal with.",
          )}
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
            {t(...filter.label)}
          </button>
        ))}
      </div>

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">
            {error instanceof ApiError
              ? error.message
              : t("Impossible de charger les recommandations.", "Recommendations could not be loaded.")}
          </p>
          <button
            onClick={() => void refetch()}
            className="mt-2 text-sm font-medium text-text underline"
          >
            {t("Réessayer", "Try again")}
          </button>
        </Card>
      )}

      {!isError && (
        <Card className="divide-y divide-border overflow-hidden">
          {isLoading && (
            <p className="px-4 py-6 text-center text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
          )}
          {!isLoading && recommendations?.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-text-muted">
              {t("Aucune recommandation pour le moment.", "No recommendations yet.")}
            </p>
          )}
          {recommendations?.map((recommendation) => (
            <div key={recommendation.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-text">{recommendation.title}</p>
                  {recommendation.severity && (
                    <Badge variant={SEVERITY_BADGE_VARIANTS[recommendation.severity]}>
                      {t(...SEVERITY_LABELS[recommendation.severity])}
                    </Badge>
                  )}
                  <Badge>{t(...STATUS_LABELS[recommendation.status])}</Badge>
                </div>
                <p className="mt-0.5 text-sm text-text-muted">{recommendation.description}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                  <span>{new Date(recommendation.createdAt).toLocaleString(intlLocale(locale))}</span>
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
                    {t("Résolue", "Resolved")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => dismissMutation.mutate(recommendation.id)}
                    loading={dismissMutation.isPending}
                  >
                    {t("Ignorer", "Dismiss")}
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
