"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createProjectSchema, type CreateProjectInput } from "@korva/validation";
import type { Contact, Project, ProjectStatus } from "@korva/types";
import { Badge, Button, Card, Input, Pagination } from "@korva/ui";
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

export default function ProjectsPage() {
  const t = useT();
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const {
    data: projectsPage,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["projects", page],
    queryFn: () => apiClient.getList<Project>(`/projects?page=${page}`),
    enabled: authReady,
  });
  const projects = projectsPage?.data;

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

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateProjectInput) =>
      apiClient.post<Project>("/projects", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      reset();
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          {t(
            "Suivez chaque mission client — heures passées, montant facturé, tâches restantes.",
            "Follow each customer job — hours spent, amount invoiced, tasks left.",
          )}
        </p>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("Annuler", "Cancel") : t("Nouveau projet", "New project")}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <select
            className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            {...register("contactId")}
            defaultValue=""
          >
            <option value="" disabled>
              {t("Client...", "Customer...")}
            </option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {[c.firstName, c.lastName].filter(Boolean).join(" ") || c.company || c.email}
              </option>
            ))}
          </select>
          {errors.contactId && (
            <p className="col-span-2 text-xs text-destructive">{errors.contactId.message}</p>
          )}

          <Input placeholder={t("Nom du projet", "Project name")} className="col-span-2" {...register("name")} />
          {errors.name && (
            <p className="col-span-2 text-xs text-destructive">{errors.name.message}</p>
          )}

          <Input
            type="number"
            step="0.5"
            placeholder={t("Budget d'heures (optionnel)", "Hours budget (optional)")}
            {...register("budgetHours", {
              setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
            })}
          />
          <Input
            type="number"
            step="0.01"
            placeholder={t("Budget en montant (optionnel)", "Amount budget (optional)")}
            {...register("budgetAmount", {
              setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
            })}
          />

          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {errorMessage(createMutation.error, t(
                "Impossible de créer ce projet.",
                "This project could not be created.",
              ))}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer le projet", "Create the project")}
          </Button>
        </form>
      )}

      {isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">{t(
            "Impossible de charger les projets.",
            "Projects could not be loaded.",
          )}</p>
          <button onClick={() => refetch()} className="mt-2 text-sm font-medium text-text underline">
            {t("Réessayer", "Try again")}
          </button>
        </Card>
      )}

      {!isError && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                <tr>
                  <th className="px-4 py-2">{t("Projet", "Project")}</th>
                  <th className="px-4 py-2">{t("Client", "Customer")}</th>
                  <th className="px-4 py-2">{t("Statut", "Status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-text-muted">
                      {t("Chargement...", "Loading...")}
                    </td>
                  </tr>
                )}
                {!isLoading && projects?.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-text-muted">
                      {t("Aucun projet.", "No projects.")}
                    </td>
                  </tr>
                )}
                {projects?.map((project) => (
                  <tr key={project.id}>
                    <td className="px-4 py-2 font-medium">
                      <Link
                        href={`/dashboard/finance/projects/${project.id}`}
                        className="text-text underline"
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-text-muted">
                      {contactName(project.contactId)}
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={STATUS_VARIANT[project.status]}>
                        {t(...STATUS_LABELS[project.status])}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Pagination
        page={page}
        totalPages={projectsPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
