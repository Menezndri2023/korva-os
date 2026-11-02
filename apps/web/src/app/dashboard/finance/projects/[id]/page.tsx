"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Contact, ProjectStatus, ProjectSummary } from "@korva/types";
import { PROJECT_STATUSES } from "@korva/types";
import { Badge, Card } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useT } from "@/lib/dashboard-locale";

const STATUS_LABELS: Record<ProjectStatus, [string, string]> = {
  active: ["Actif", "Active"],
  on_hold: ["En pause", "On hold"],
  completed: ["Terminé", "Completed"],
  archived: ["Archivé", "Archived"],
};

const STATUS_VARIANT: Record<
  ProjectStatus,
  "default" | "success" | "warning" | "destructive"
> = {
  active: "success",
  on_hold: "warning",
  completed: "default",
  archived: "destructive",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function ProjectDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const summaryQuery = useQuery({
    queryKey: ["projects", id, "summary"],
    queryFn: () => apiClient.get<ProjectSummary>(`/projects/${id}/summary`),
    enabled: authReady,
  });

  const { data: contacts } = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });

  function contactName(contactId: string): string {
    const contact = contacts?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return (
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.company ||
      "—"
    );
  }

  const statusMutation = useMutation({
    mutationFn: (status: ProjectStatus) =>
      apiClient.patch(`/projects/${id}`, { status }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["projects", id] }),
  });

  if (summaryQuery.isLoading) {
    return <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>;
  }

  if (summaryQuery.isError) {
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">
          {errorMessage(summaryQuery.error, t(
            "Impossible de charger ce projet.",
            "This project could not be loaded.",
          ))}
        </p>
      </Card>
    );
  }

  const summary = summaryQuery.data;
  if (!summary) return null;
  const { project } = summary;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{project.name}</h1>
          <p className="text-sm text-text-muted">{contactName(project.contactId)}</p>
        </div>
        <select
          className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
          value={project.status}
          onChange={(e) => statusMutation.mutate(e.target.value as ProjectStatus)}
          disabled={statusMutation.isPending}
        >
          {PROJECT_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(...STATUS_LABELS[status])}
            </option>
          ))}
        </select>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant={STATUS_VARIANT[project.status]}>{t(...STATUS_LABELS[project.status])}</Badge>
      </div>

      {project.description && <p className="text-sm text-text-muted">{project.description}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs text-text-muted">{t("Heures totales", "Total hours")}</p>
          <p className="mt-1 text-2xl font-semibold">{summary.totalHoursLogged}h</p>
          {project.budgetHours && (
            <p className="mt-1 text-xs text-text-muted">Budget : {project.budgetHours}h</p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-muted">{t("Heures facturables", "Billable hours")}</p>
          <p className="mt-1 text-2xl font-semibold">{summary.billableHoursLogged}h</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-muted">{t("Montant facturé", "Amount invoiced")}</p>
          <p className="mt-1 text-2xl font-semibold">
            {summary.totalBilled} {project.currency ?? ""}
          </p>
          {project.budgetAmount && (
            <p className="mt-1 text-xs text-text-muted">
              Budget : {project.budgetAmount} {project.currency ?? ""}
            </p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-xs text-text-muted">{t("Tâches", "Tasks")}</p>
          <p className="mt-1 text-2xl font-semibold">
            {summary.totalTaskCount - summary.openTaskCount}/{summary.totalTaskCount}
          </p>
          <p className="mt-1 text-xs text-text-muted">{summary.openTaskCount} en cours</p>
        </Card>
      </div>
    </div>
  );
}
