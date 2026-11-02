"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ACTION_CENTER_SEVERITIES } from "@korva/types";
import type { ActionCenterItem, ActionCenterSeverity, ActionCenterSummary, Recommendation } from "@korva/types";
import { Badge, Button, Card } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { intlLocale, useDashboardLocale, useT, type Translate } from "@/lib/dashboard-locale";

function itemTypeLabel(type: ActionCenterItem["type"], t: Translate): string {
  switch (type) {
    case "recommendation":
      return t("Recommandation", "Recommendation");
    case "pending_approval":
      return t("Approbation requise", "Approval needed");
    case "workflow_failure":
      return t("Échec d'automatisation", "Automation failed");
    case "webhook_delivery_failure":
      return t("Échec de livraison webhook", "Webhook delivery failed");
  }
}

const ITEM_TYPE_LINKS: Record<ActionCenterItem["type"], string> = {
  recommendation: "/dashboard/recommendations",
  pending_approval: "/dashboard/ai",
  workflow_failure: "/dashboard/workflows",
  webhook_delivery_failure: "/dashboard/settings#integrations",
};

function severityLabel(severity: ActionCenterSeverity, t: Translate): string {
  switch (severity) {
    case "urgent":
      return t("Urgent", "Urgent");
    case "attention":
      return t("À surveiller", "To watch");
    case "opportunity":
      return t("Opportunité", "Opportunity");
    case "recommendation":
      return t("Recommandation", "Recommendation");
  }
}

const SEVERITY_BADGE_VARIANTS: Record<
  ActionCenterSeverity,
  "default" | "success" | "warning" | "destructive"
> = {
  urgent: "destructive",
  attention: "warning",
  opportunity: "success",
  recommendation: "default",
};

function groupBySeverity(items: ActionCenterItem[]): [ActionCenterSeverity, ActionCenterItem[]][] {
  return ACTION_CENTER_SEVERITIES.map((severity) => [
    severity,
    items.filter((item) => item.severity === severity),
  ]).filter(([, group]) => group.length > 0) as [ActionCenterSeverity, ActionCenterItem[]][];
}

export default function ActionCenterPage() {
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const locale = useDashboardLocale();
  const t = useT();

  const summaryQuery = useQuery({
    queryKey: ["action-center", "summary"],
    queryFn: () => apiClient.get<ActionCenterSummary>("/action-center/summary"),
    enabled: authReady,
  });

  const feedQuery = useQuery({
    queryKey: ["action-center", "feed"],
    queryFn: () => apiClient.get<ActionCenterItem[]>("/action-center/feed"),
    enabled: authReady,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["action-center"] });
    void queryClient.invalidateQueries({ queryKey: ["recommendations"] });
  };

  const dismissMutation = useMutation({
    mutationFn: (id: string) => apiClient.post<Recommendation>(`/recommendations/${id}/dismiss`),
    onSuccess: invalidate,
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => apiClient.post<Recommendation>(`/recommendations/${id}/resolve`),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("Centre d'action", "Action centre")}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {t(
            "Ce qui a besoin de votre attention dans votre entreprise, en un seul endroit.",
            "What needs your attention in your business, in one place.",
          )}
        </p>
      </div>

      {summaryQuery.isLoading && <SummarySkeleton />}
      {summaryQuery.data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile
            label={t("Approbations", "Approvals")}
            value={summaryQuery.data.pendingApprovals}
            href="/dashboard/ai"
          />
          <SummaryTile
            label={t("Recommandations", "Recommendations")}
            value={summaryQuery.data.recommendations}
            href="/dashboard/recommendations"
          />
          <SummaryTile
            label={t("Automatisé cette semaine", "Automated this week")}
            value={summaryQuery.data.automatedThisWeek}
            href="/dashboard/workflows"
          />
          <SummaryTile
            label={t("Échecs", "Failures")}
            value={summaryQuery.data.failures}
            href="/dashboard/workflows"
            warn={summaryQuery.data.failures > 0}
          />
        </div>
      )}

      {feedQuery.isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">
            {feedQuery.error instanceof ApiError
              ? feedQuery.error.message
              : t("Impossible de charger le centre d'action.", "The action centre could not be loaded.")}
          </p>
        </Card>
      )}

      {feedQuery.isLoading && (
        <Card>
          <p className="px-4 py-6 text-center text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>
        </Card>
      )}
      {!feedQuery.isError && !feedQuery.isLoading && feedQuery.data?.length === 0 && (
        <Card>
          <p className="px-4 py-6 text-center text-sm text-text-muted">
            {t("Rien ne nécessite votre attention pour le moment.", "Nothing needs your attention right now.")}
          </p>
        </Card>
      )}

      {!feedQuery.isError &&
        !feedQuery.isLoading &&
        feedQuery.data &&
        groupBySeverity(feedQuery.data).map(([severity, items]) => (
          <div key={severity}>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant={SEVERITY_BADGE_VARIANTS[severity]}>{severityLabel(severity, t)}</Badge>
              <span className="text-xs text-text-muted">{items.length}</span>
            </div>
            <Card className="divide-y divide-border overflow-hidden">
              {items.map((item) => (
                <div
                  key={`${item.type}-${item.id}`}
                  className="flex items-start justify-between gap-3 px-4 py-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge>{itemTypeLabel(item.type, t)}</Badge>
                      <Link
                        href={ITEM_TYPE_LINKS[item.type]}
                        className="text-sm font-medium text-text hover:underline"
                      >
                        {item.title}
                      </Link>
                    </div>
                    {item.description && (
                      <p className="mt-0.5 text-sm text-text-muted">{item.description}</p>
                    )}
                    <div className="mt-1 flex items-center gap-2 text-xs text-text-muted">
                      <span>{new Date(item.occurredAt).toLocaleString(intlLocale(locale))}</span>
                      {item.impact && <span>· {item.impact}</span>}
                    </div>
                  </div>
                  {item.type === "recommendation" && (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => resolveMutation.mutate(item.id)}
                        loading={resolveMutation.isPending}
                      >
                        {t("Résolue", "Resolved")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => dismissMutation.mutate(item.id)}
                        loading={dismissMutation.isPending}
                      >
                        {t("Ignorer", "Dismiss")}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </Card>
          </div>
        ))}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  href,
  warn,
}: {
  label: string;
  value: number;
  href: string;
  warn?: boolean;
}) {
  return (
    <Link href={href}>
      <Card className="p-4 transition-colors hover:bg-surface-muted">
        <p className="text-xs font-medium text-text-muted">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${warn ? "text-destructive" : "text-text"}`}>
          {value}
        </p>
      </Card>
    </Link>
  );
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="p-4">
          <div className="h-3 w-16 animate-pulse rounded bg-surface-muted" />
          <div className="mt-2 h-6 w-20 animate-pulse rounded bg-surface-muted" />
        </Card>
      ))}
    </div>
  );
}
