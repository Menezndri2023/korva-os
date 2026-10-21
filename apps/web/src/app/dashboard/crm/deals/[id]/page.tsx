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
import { DEAL_STATUS_LABELS } from "@/lib/analytics-format";
import { RelationSection } from "@/components/relation-section";
import { CustomFieldsDisplay } from "@/components/custom-fields-display";

export default function DealDetailPage() {
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
    return <p className="text-sm text-text-muted">Chargement...</p>;
  }

  if (dealQuery.isError || !dealQuery.data) {
    const error = dealQuery.error;
    const message =
      error instanceof ApiError ? error.message : "Impossible de charger cette affaire.";
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/crm/deals"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          Retour aux affaires
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
        ← Affaires
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
              <Badge>{DEAL_STATUS_LABELS[deal.status] ?? deal.status}</Badge>
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
                  aria-label="Étape"
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
                  Gagner
                </Button>
                <Button
                  variant="secondary"
                  loading={loseMutation.isPending}
                  disabled={isTransitioning}
                  onClick={() => {
                    const lossReason = window.prompt("Raison de la perte (optionnel)") ?? undefined;
                    loseMutation.mutate(lossReason);
                  }}
                >
                  Perdre
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
                Rouvrir
              </Button>
            )}
          </div>
        </div>

        {(moveStageMutation.isError ||
          winMutation.isError ||
          loseMutation.isError ||
          reopenMutation.isError) && (
          <p className="mt-3 text-sm text-destructive">Impossible de mettre à jour l&apos;affaire.</p>
        )}

        <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
          <p className="text-sm font-medium text-text">Détails</p>
          <button
            onClick={() => setEditing((v) => !v)}
            className="text-xs font-medium text-text underline"
          >
            {editing ? "Annuler" : "Modifier"}
          </button>
        </div>

        {!editing ? (
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm md:grid-cols-3">
            <div>
              <dt className="text-text-muted">Responsable</dt>
              <dd className="mt-0.5">{deal.ownerId ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Valeur estimée</dt>
              <dd className="mt-0.5">{deal.estimatedValue ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Probabilité</dt>
              <dd className="mt-0.5">{deal.probability != null ? `${deal.probability}%` : "—"}</dd>
            </div>
            {deal.lossReason && (
              <div>
                <dt className="text-text-muted">Raison de la perte</dt>
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
              placeholder="Valeur estimée"
              {...register("estimatedValue", {
                setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
              })}
            />
            <Input
              type="number"
              placeholder="Probabilité (%)"
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
                  : "Impossible de mettre à jour cette affaire."}
              </p>
            )}
            <Button type="submit" loading={updateMutation.isPending} className="col-span-2">
              Enregistrer
            </Button>
          </form>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RelationSection<Task>
          title="Tâches"
          query={tasksQuery}
          emptyLabel="Aucune tâche."
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
                placeholder="Nouvelle tâche..."
                aria-label="Titre de la tâche"
                {...registerTask("title")}
              />
              <Input
                type="datetime-local"
                aria-label="Échéance"
                value={taskDueAt}
                onChange={(e) => setTaskDueAt(e.target.value)}
              />
              <Button type="submit" size="sm" loading={createTaskMutation.isPending}>
                Ajouter
              </Button>
              {taskErrors.title && (
                <p className="w-full text-xs text-destructive">{taskErrors.title.message}</p>
              )}
              {createTaskMutation.isError && (
                <p className="w-full text-xs text-destructive">
                  {createTaskMutation.error instanceof ApiError
                    ? createTaskMutation.error.message
                    : "Impossible d'ajouter la tâche."}
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
                    Terminer
                  </Button>
                )}
              </div>
            </div>
          )}
        />
        <RelationSection<Note>
          title="Notes"
          query={notesQuery}
          emptyLabel="Aucune note."
          header={
            <form
              className="flex flex-wrap items-start gap-2"
              onSubmit={handleNoteSubmit((values) => createNoteMutation.mutate(values))}
            >
              <Input
                className="min-w-0 flex-1"
                placeholder="Ajouter une note..."
                aria-label="Contenu de la note"
                {...registerNote("content")}
              />
              <Button type="submit" size="sm" loading={createNoteMutation.isPending}>
                Ajouter
              </Button>
              {noteErrors.content && (
                <p className="w-full text-xs text-destructive">{noteErrors.content.message}</p>
              )}
              {createNoteMutation.isError && (
                <p className="w-full text-xs text-destructive">
                  {createNoteMutation.error instanceof ApiError
                    ? createNoteMutation.error.message
                    : "Impossible d'ajouter la note."}
                </p>
              )}
            </form>
          }
          renderItem={(note) => <p className="text-text">{note.content}</p>}
        />
        <RelationSection<Activity>
          title="Activité"
          query={activitiesQuery}
          emptyLabel="Aucune activité récente."
          header={
            <form
              className="flex flex-wrap items-start gap-2"
              onSubmit={handleActivitySubmit((values) => createActivityMutation.mutate(values))}
            >
              <select
                aria-label="Type d'activité"
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
                placeholder="Détails (optionnel)"
                aria-label="Détails de l'activité"
                {...registerActivity("content")}
              />
              <Button type="submit" size="sm" loading={createActivityMutation.isPending}>
                Ajouter
              </Button>
              {createActivityMutation.isError && (
                <p className="w-full text-xs text-destructive">
                  {createActivityMutation.error instanceof ApiError
                    ? createActivityMutation.error.message
                    : "Impossible d'ajouter l'activité."}
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
                {new Date(activity.createdAt).toLocaleString("fr-FR")}
              </span>
            </div>
          )}
        />
      </div>
    </div>
  );
}
