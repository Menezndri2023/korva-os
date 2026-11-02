"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createActivitySchema,
  createNoteSchema,
  createTaskSchema,
  updateDealSchema,
  type CreateActivityInput,
  type CreateNoteInput,
  type CreateTaskInput,
  type UpdateDealInput,
} from "@korva/validation";
import { ACTIVITY_TYPES } from "@korva/types";
import type { Activity, Contact, Deal, Lead, Note, Pipeline, Task } from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import {
  DEAL_STATUS_LABELS,
  DEAL_STATUS_LABELS_EN,
  labelIn,
} from "@/lib/analytics-format";
import { RelationSection } from "@/components/relation-section";
import { CustomFieldsDisplay } from "@/components/custom-fields-display";
import { intlLocale, useDashboardLocale, useT } from "@/lib/dashboard-locale";

export default function DealDetailPage() {
  const locale = useDashboardLocale();
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const [editing, setEditing] = useState(false);

  const dealQuery = useQuery({
    queryKey: ["deals", id],
    queryFn: () => apiClient.get<Deal>(`/deals/${id}`),
    enabled: authReady,
  });
  const contactsQuery = useQuery({
    queryKey: ["contacts", ""],
    queryFn: () => apiClient.get<Contact[]>("/contacts"),
    enabled: authReady,
  });
  const pipelinesQuery = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => apiClient.get<Pipeline[]>("/pipelines"),
    enabled: authReady,
  });
  const leadQuery = useQuery({
    queryKey: ["leads", dealQuery.data?.leadId],
    queryFn: () => apiClient.get<Lead>(`/leads/${dealQuery.data?.leadId}`),
    enabled: authReady && !!dealQuery.data?.leadId,
  });
  const notesQuery = useQuery({
    queryKey: ["notes", "deal", id],
    queryFn: () => apiClient.get<Note[]>(`/notes?entity=deal&entityId=${id}`),
    enabled: authReady,
  });
  const tasksQuery = useQuery({
    queryKey: ["tasks", "deal", id],
    queryFn: () => apiClient.get<Task[]>(`/tasks?entity=deal&entityId=${id}`),
    enabled: authReady,
  });
  const activitiesQuery = useQuery({
    queryKey: ["activities", "deal", id],
    queryFn: () => apiClient.get<Activity[]>(`/activities?entity=deal&entityId=${id}`),
    enabled: authReady,
  });

  const moveStageMutation = useMutation({
    mutationFn: (stageId: string) => apiClient.post<Deal>(`/deals/${id}/move-stage`, { stageId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deals", id] }),
  });
  const winMutation = useMutation({
    mutationFn: () => apiClient.post<Deal>(`/deals/${id}/win`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deals", id] }),
  });
  const loseMutation = useMutation({
    mutationFn: (lossReason?: string) => apiClient.post<Deal>(`/deals/${id}/lose`, { lossReason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deals", id] }),
  });
  const reopenMutation = useMutation({
    mutationFn: () => apiClient.post<Deal>(`/deals/${id}/reopen`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["deals", id] }),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UpdateDealInput>({ resolver: zodResolver(updateDealSchema) });

  useEffect(() => {
    if (dealQuery.data) {
      reset({
        estimatedValue: dealQuery.data.estimatedValue,
        probability: dealQuery.data.probability,
      });
    }
  }, [dealQuery.data, reset]);

  const updateMutation = useMutation({
    mutationFn: (input: UpdateDealInput) => apiClient.patch<Deal>(`/deals/${id}`, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["deals", id] });
      setEditing(false);
    },
  });

  const {
    register: registerNote,
    handleSubmit: handleNoteSubmit,
    reset: resetNoteForm,
    formState: { errors: noteErrors },
  } = useForm<CreateNoteInput>({
    resolver: zodResolver(createNoteSchema),
    defaultValues: { entity: "deal", entityId: id, content: "" },
  });
  const createNoteMutation = useMutation({
    mutationFn: (input: CreateNoteInput) => apiClient.post<Note>("/notes", input),
    onSuccess: () => {
      resetNoteForm({ entity: "deal", entityId: id, content: "" });
      return queryClient.invalidateQueries({ queryKey: ["notes", "deal", id] });
    },
  });

  const [taskDueAt, setTaskDueAt] = useState("");
  const {
    register: registerTask,
    handleSubmit: handleTaskSubmit,
    reset: resetTaskForm,
    formState: { errors: taskErrors },
  } = useForm<CreateTaskInput>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: { entity: "deal", entityId: id, title: "" },
  });
  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => apiClient.post<Task>("/tasks", input),
    onSuccess: () => {
      resetTaskForm({ entity: "deal", entityId: id, title: "" });
      setTaskDueAt("");
      return queryClient.invalidateQueries({ queryKey: ["tasks", "deal", id] });
    },
  });
  const completeTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.patch<Task>(`/tasks/${taskId}`, { status: "done" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", "deal", id] }),
  });

  const {
    register: registerActivity,
    handleSubmit: handleActivitySubmit,
    reset: resetActivityForm,
  } = useForm<CreateActivityInput>({
    resolver: zodResolver(createActivitySchema),
    defaultValues: { entity: "deal", entityId: id, type: "note", content: "" },
  });
  const createActivityMutation = useMutation({
    mutationFn: (input: CreateActivityInput) => apiClient.post<Activity>("/activities", input),
    onSuccess: () => {
      resetActivityForm({ entity: "deal", entityId: id, type: "note", content: "" });
      return queryClient.invalidateQueries({ queryKey: ["activities", "deal", id] });
    },
  });

  function contactName(contactId: string): string {
    const contact = contactsQuery.data?.find((c) => c.id === contactId);
    if (!contact) return "—";
    return (
      [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
      contact.company ||
      "—"
    );
  }

  if (dealQuery.isLoading) {
    return <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>;
  }

  if (dealQuery.isError || !dealQuery.data) {
    const error = dealQuery.error;
    const message =
      error instanceof ApiError ? error.message : t(
        "Impossible de charger cette affaire.",
        "This deal could not be loaded.",
      );
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/crm/deals"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          {t("Retour aux affaires", "Back to deals")}
        </Link>
      </Card>
    );
  }

  const deal = dealQuery.data;
  const pipeline = pipelinesQuery.data?.find((p) => p.id === deal.pipelineId);
  const isTransitioning =
    moveStageMutation.isPending || winMutation.isPending || loseMutation.isPending || reopenMutation.isPending;

  return (
    <div className="space-y-4">
      <Link href="/dashboard/crm/deals" className="text-sm text-text-muted hover:underline">
        {t("← Affaires", "← Deals")}
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">
              <Link
                href={`/dashboard/crm/${deal.contactId}`}
                className="underline-offset-2 hover:underline"
              >
                {contactName(deal.contactId)}
              </Link>
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-sm text-text-muted">{pipeline?.name ?? "—"}</p>
              <Badge>{labelIn(DEAL_STATUS_LABELS, DEAL_STATUS_LABELS_EN, deal.status, locale)}</Badge>
            </div>
            {deal.leadId && (
              <Link
                href={`/dashboard/crm/leads/${deal.leadId}`}
                className="mt-1 inline-block text-xs text-text-muted underline-offset-2 hover:underline"
              >
                Issue du prospect {leadQuery.data?.source ?? ""}
              </Link>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {deal.status === "open" && (
              <>
                <select
                  aria-label={t("Étape", "Stage")}
                  value={deal.stageId}
                  disabled={isTransitioning || !pipeline}
                  onChange={(e) => moveStageMutation.mutate(e.target.value)}
                  className="rounded-md border border-border-input px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pipeline?.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
                <Button
                  variant="secondary"
                  loading={winMutation.isPending}
                  disabled={isTransitioning}
                  onClick={() => winMutation.mutate()}
                >
                  {t("Gagner", "Win")}
                </Button>
                <Button
                  variant="secondary"
                  loading={loseMutation.isPending}
                  disabled={isTransitioning}
                  onClick={() => {
                    const lossReason = window.prompt(t(
                      "Raison de la perte (optionnel)",
                      "Reason lost (optional)",
                    )) ?? undefined;
                    loseMutation.mutate(lossReason);
                  }}
                >
                  {t("Perdre", "Lose")}
                </Button>
              </>
            )}
            {deal.status !== "open" && (
              <Button
                variant="secondary"
                loading={reopenMutation.isPending}
                disabled={isTransitioning}
                onClick={() => reopenMutation.mutate()}
              >
                {t("Rouvrir", "Reopen")}
              </Button>
            )}
          </div>
        </div>

        {(moveStageMutation.isError ||
          winMutation.isError ||
          loseMutation.isError ||
          reopenMutation.isError) && (
          <p className="mt-3 text-sm text-destructive">{t(
            "Impossible de mettre à jour l'affaire.",
            "The deal could not be updated.",
          )}</p>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <p className="text-sm font-medium text-text">{t("Détails", "Details")}</p>
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-xs font-medium text-text underline"
          >
            {editing ? t("Annuler", "Cancel") : t("Modifier", "Edit")}
          </button>
        </div>

        {!editing ? (
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div>
              <dt className="text-text-muted">{t("Responsable", "Owner")}</dt>
              <dd className="mt-0.5">{deal.ownerId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Valeur estimée", "Estimated value")}</dt>
              <dd className="mt-0.5">{deal.estimatedValue ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Probabilité", "Probability")}</dt>
              <dd className="mt-0.5">{deal.probability != null ? `${deal.probability}%` : "—"}</dd>
            </div>
            {deal.lossReason && (
              <div>
                <dt className="text-text-muted">{t("Raison de la perte", "Reason lost")}</dt>
                <dd className="mt-0.5">{deal.lossReason}</dd>
              </div>
            )}
            <CustomFieldsDisplay entity="deals" values={deal.customFields} />
          </dl>
        ) : (
          <form
            onSubmit={handleSubmit((values) => updateMutation.mutate(values))}
            className="mt-3 grid grid-cols-2 gap-3"
          >
            <Input
              type="number"
              placeholder={t("Valeur estimée", "Estimated value")}
              {...register("estimatedValue", {
                setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
              })}
            />
            <Input
              type="number"
              placeholder={t("Probabilité (%)", "Probability (%)")}
              {...register("probability", {
                setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
              })}
            />
            {errors.estimatedValue && (
              <p className="text-xs text-destructive">{errors.estimatedValue.message}</p>
            )}
            {updateMutation.isError && (
              <p className="col-span-2 text-sm text-destructive">
                {updateMutation.error instanceof ApiError
                  ? updateMutation.error.message
                  : t("Impossible de mettre à jour cette affaire.", "This deal could not be updated.")}
              </p>
            )}
            <Button type="submit" loading={updateMutation.isPending} className="col-span-2">
              {t("Enregistrer", "Save")}
            </Button>
          </form>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RelationSection<Task>
          title={t("Tâches", "Tasks")}
          query={tasksQuery}
          emptyLabel={t("Aucune tâche.", "No tasks.")}
          header={
            <form
              className="flex flex-wrap items-start gap-2"
              onSubmit={handleTaskSubmit((values) =>
                createTaskMutation.mutate({
                  ...values,
                  ...(taskDueAt ? { dueAt: new Date(taskDueAt).toISOString() } : {}),
                }),
              )}
            >
              <Input
                className="min-w-0 flex-1"
                placeholder={t("Nouvelle tâche...", "New task...")}
                aria-label={t("Titre de la tâche", "Task title")}
                {...registerTask("title")}
              />
              <Input
                type="datetime-local"
                aria-label={t("Échéance", "Due date")}
                value={taskDueAt}
                onChange={(e) => setTaskDueAt(e.target.value)}
              />
              <Button type="submit" size="sm" loading={createTaskMutation.isPending}>
                {t("Ajouter", "Add")}
              </Button>
              {taskErrors.title && (
                <p className="w-full text-xs text-destructive">{taskErrors.title.message}</p>
              )}
              {createTaskMutation.isError && (
                <p className="w-full text-xs text-destructive">
                  {createTaskMutation.error instanceof ApiError
                    ? createTaskMutation.error.message
                    : t("Impossible d'ajouter la tâche.", "The task could not be added.")}
                </p>
              )}
            </form>
          }
          renderItem={(task) => (
            <div className="flex items-center justify-between gap-2">
              <span>{task.title}</span>
              <div className="flex items-center gap-2">
                <Badge>{task.status}</Badge>
                {task.status === "pending" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={
                      completeTaskMutation.isPending &&
                      completeTaskMutation.variables === task.id
                    }
                    onClick={() => completeTaskMutation.mutate(task.id)}
                  >
                    {t("Terminer", "Done")}
                  </Button>
                )}
              </div>
            </div>
          )}
        />
        <RelationSection<Note>
          title={t("Notes", "Notes")}
          query={notesQuery}
          emptyLabel={t("Aucune note.", "No notes.")}
          header={
            <form
              className="flex flex-wrap items-start gap-2"
              onSubmit={handleNoteSubmit((values) => createNoteMutation.mutate(values))}
            >
              <Input
                className="min-w-0 flex-1"
                placeholder={t("Ajouter une note...", "Add a note...")}
                aria-label={t("Contenu de la note", "Note content")}
                {...registerNote("content")}
              />
              <Button type="submit" size="sm" loading={createNoteMutation.isPending}>
                {t("Ajouter", "Add")}
              </Button>
              {noteErrors.content && (
                <p className="w-full text-xs text-destructive">{noteErrors.content.message}</p>
              )}
              {createNoteMutation.isError && (
                <p className="w-full text-xs text-destructive">
                  {createNoteMutation.error instanceof ApiError
                    ? createNoteMutation.error.message
                    : t("Impossible d'ajouter la note.", "The note could not be added.")}
                </p>
              )}
            </form>
          }
          renderItem={(note) => <p className="text-text">{note.content}</p>}
        />
        <RelationSection<Activity>
          title={t("Activité", "Activity")}
          query={activitiesQuery}
          emptyLabel={t("Aucune activité récente.", "No recent activity.")}
          header={
            <form
              className="flex flex-wrap items-start gap-2"
              onSubmit={handleActivitySubmit((values) => createActivityMutation.mutate(values))}
            >
              <select
                aria-label={t("Type d'activité", "Activity type")}
                className="rounded-md border border-border-input px-2 py-2 text-sm"
                {...registerActivity("type")}
              >
                {ACTIVITY_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <Input
                className="min-w-0 flex-1"
                placeholder={t("Détails (optionnel)", "Details (optional)")}
                aria-label={t("Détails de l'activité", "Activity details")}
                {...registerActivity("content")}
              />
              <Button type="submit" size="sm" loading={createActivityMutation.isPending}>
                {t("Ajouter", "Add")}
              </Button>
              {createActivityMutation.isError && (
                <p className="w-full text-xs text-destructive">
                  {createActivityMutation.error instanceof ApiError
                    ? createActivityMutation.error.message
                    : t("Impossible d'ajouter l'activité.", "The activity could not be added.")}
                </p>
              )}
            </form>
          }
          renderItem={(activity) => (
            <div className="flex items-center justify-between">
              <span>
                {activity.type}
                {activity.content ? ` — ${activity.content}` : ""}
              </span>
              <span className="text-text-muted">
                {new Date(activity.createdAt).toLocaleString(intlLocale(locale))}
              </span>
            </div>
          )}
        />
      </div>
    </div>
  );
}
