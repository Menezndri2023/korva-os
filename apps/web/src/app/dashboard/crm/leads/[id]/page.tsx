"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  convertLeadSchema,
  createActivitySchema,
  createNoteSchema,
  createTaskSchema,
  type ConvertLeadInput,
  type CreateActivityInput,
  type CreateNoteInput,
  type CreateTaskInput,
  type UpdateLeadInput,
} from "@korva/validation";
import { ACTIVITY_TYPES, LEAD_STATUSES } from "@korva/types";
import type { Activity, Contact, Deal, Lead, Note, Pipeline, Task } from "@korva/types";
import { Badge, Button, Card, Input, Select } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { LEAD_STATUS_LABELS } from "@/lib/analytics-format";
import { RelationSection } from "@/components/relation-section";
import { CustomFieldsDisplay } from "@/components/custom-fields-display";

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const [showConvertForm, setShowConvertForm] = useState(false);

  const leadQuery = useQuery({
    queryKey: ["leads", id],
    queryFn: () => apiClient.get<Lead>(`/leads/${id}`),
    enabled: authReady,
  });
  // Phase D4 (docs/KORVA_OS_V2_AUDIT.md §2.5) — a deterministic 0-100 score, computed on read.
  const scoreQuery = useQuery({
    queryKey: ["leads", id, "score"],
    queryFn: () => apiClient.get<{ score: number; factors: Record<string, number> }>(`/leads/${id}/score`),
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
  const dealsQuery = useQuery({
    queryKey: ["deals", "lead", id],
    queryFn: () => apiClient.get<Deal[]>(`/deals?leadId=${id}`),
    enabled: authReady,
  });
  const notesQuery = useQuery({
    queryKey: ["notes", "lead", id],
    queryFn: () => apiClient.get<Note[]>(`/notes?entity=lead&entityId=${id}`),
    enabled: authReady,
  });
  const tasksQuery = useQuery({
    queryKey: ["tasks", "lead", id],
    queryFn: () => apiClient.get<Task[]>(`/tasks?entity=lead&entityId=${id}`),
    enabled: authReady,
  });
  const activitiesQuery = useQuery({
    queryKey: ["activities", "lead", id],
    queryFn: () => apiClient.get<Activity[]>(`/activities?entity=lead&entityId=${id}`),
    enabled: authReady,
  });

  const updateLeadMutation = useMutation({
    mutationFn: (input: UpdateLeadInput) => apiClient.patch<Lead>(`/leads/${id}`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["leads"] }),
  });

  const defaultPipeline = pipelinesQuery.data?.find((p) => p.isDefault) ?? pipelinesQuery.data?.[0];
  const {
    register: registerConvert,
    handleSubmit: handleConvertSubmit,
    watch: watchConvert,
    formState: { errors: convertErrors },
  } = useForm<ConvertLeadInput>({
    resolver: zodResolver(convertLeadSchema),
    defaultValues: {
      pipelineId: defaultPipeline?.id,
      stageId: defaultPipeline?.stages[0]?.id,
    },
  });
  const convertPipelineId = watchConvert("pipelineId");
  const convertPipeline = pipelinesQuery.data?.find((p) => p.id === convertPipelineId) ?? defaultPipeline;

  const convertMutation = useMutation({
    mutationFn: (input: ConvertLeadInput) =>
      apiClient.post<{ lead: Lead; deal: Deal }>(`/leads/${id}/convert`, input),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["leads"] });
      void queryClient.invalidateQueries({ queryKey: ["deals"] });
      router.push(`/dashboard/crm/deals/${result.deal.id}`);
    },
  });

  const {
    register: registerNote,
    handleSubmit: handleNoteSubmit,
    reset: resetNoteForm,
    formState: { errors: noteErrors },
  } = useForm<CreateNoteInput>({
    resolver: zodResolver(createNoteSchema),
    defaultValues: { entity: "lead", entityId: id, content: "" },
  });
  const createNoteMutation = useMutation({
    mutationFn: (input: CreateNoteInput) => apiClient.post<Note>("/notes", input),
    onSuccess: () => {
      resetNoteForm({ entity: "lead", entityId: id, content: "" });
      return queryClient.invalidateQueries({ queryKey: ["notes", "lead", id] });
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
    defaultValues: { entity: "lead", entityId: id, title: "" },
  });
  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => apiClient.post<Task>("/tasks", input),
    onSuccess: () => {
      resetTaskForm({ entity: "lead", entityId: id, title: "" });
      setTaskDueAt("");
      return queryClient.invalidateQueries({ queryKey: ["tasks", "lead", id] });
    },
  });
  const completeTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.patch<Task>(`/tasks/${taskId}`, { status: "done" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", "lead", id] }),
  });

  const {
    register: registerActivity,
    handleSubmit: handleActivitySubmit,
    reset: resetActivityForm,
  } = useForm<CreateActivityInput>({
    resolver: zodResolver(createActivitySchema),
    defaultValues: { entity: "lead", entityId: id, type: "note", content: "" },
  });
  const createActivityMutation = useMutation({
    mutationFn: (input: CreateActivityInput) => apiClient.post<Activity>("/activities", input),
    onSuccess: () => {
      resetActivityForm({ entity: "lead", entityId: id, type: "note", content: "" });
      return queryClient.invalidateQueries({ queryKey: ["activities", "lead", id] });
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

  if (leadQuery.isLoading) {
    return <p className="text-sm text-text-muted">Chargement...</p>;
  }

  if (leadQuery.isError || !leadQuery.data) {
    const error = leadQuery.error;
    const message =
      error instanceof ApiError ? error.message : "Impossible de charger ce prospect.";
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/crm/leads"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          Retour aux prospects
        </Link>
      </Card>
    );
  }

  const lead = leadQuery.data;
  const isUpdating = updateLeadMutation.isPending;

  return (
    <div className="space-y-4">
      <Link href="/dashboard/crm/leads" className="text-sm text-text-muted hover:underline">
        ← Prospects
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">
              <Link
                href={`/dashboard/crm/${lead.contactId}`}
                className="underline-offset-2 hover:underline"
              >
                {contactName(lead.contactId)}
              </Link>
            </h1>
            <p className="text-sm text-text-muted">{lead.source ?? "—"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {scoreQuery.data && (
              <Badge title="Score basé sur la complétude du contact, l'engagement et la fraîcheur du prospect">
                Score : {scoreQuery.data.score}/100
              </Badge>
            )}
            <select
              aria-label="Statut"
              value={lead.status}
              disabled={isUpdating}
              onChange={(e) =>
                updateLeadMutation.mutate({ status: e.target.value as Lead["status"] })
              }
              className="rounded-md border border-border-input px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
            >
              {LEAD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {LEAD_STATUS_LABELS[status] ?? status}
                </option>
              ))}
            </select>
            {lead.status !== "converted" && (
              <Button onClick={() => setShowConvertForm((v) => !v)}>
                {showConvertForm ? "Annuler" : "Convertir en affaire"}
              </Button>
            )}
          </div>
        </div>

        {updateLeadMutation.isError && (
          <p className="mt-3 text-sm text-destructive">
            {updateLeadMutation.error instanceof ApiError
              ? updateLeadMutation.error.message
              : "Impossible de mettre à jour le prospect."}
          </p>
        )}

        {showConvertForm && (
          <form
            onSubmit={handleConvertSubmit((values) => convertMutation.mutate(values))}
            className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface-muted p-4"
          >
            <Select {...registerConvert("pipelineId")}>
              {pipelinesQuery.data?.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.name}
                </option>
              ))}
            </Select>
            <Select {...registerConvert("stageId")}>
              {convertPipeline?.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
            <Input
              type="number"
              placeholder="Valeur estimée"
              {...registerConvert("estimatedValue", {
                setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
              })}
            />
            <Input
              type="number"
              placeholder="Probabilité (%)"
              {...registerConvert("probability", {
                setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
              })}
            />
            {convertErrors.pipelineId && (
              <p className="col-span-2 text-xs text-destructive">{convertErrors.pipelineId.message}</p>
            )}
            {convertMutation.isError && (
              <p className="col-span-2 text-sm text-destructive">
                {convertMutation.error instanceof ApiError
                  ? convertMutation.error.message
                  : "Impossible de convertir ce prospect."}
              </p>
            )}
            <Button type="submit" loading={convertMutation.isPending} className="col-span-2">
              {convertMutation.isPending ? "Conversion..." : "Convertir"}
            </Button>
          </form>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
          <div>
            <dt className="text-text-muted">Source</dt>
            <dd className="mt-0.5">{lead.source ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Responsable</dt>
            <dd className="mt-0.5">{lead.ownerId ?? "—"}</dd>
          </div>
          <CustomFieldsDisplay entity="leads" values={lead.customFields} />
        </dl>

        {dealsQuery.data && dealsQuery.data.length > 0 && (
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-sm font-medium text-text">Affaires liées</p>
            <ul className="mt-2 space-y-1">
              {dealsQuery.data.map((deal) => (
                <li key={deal.id} className="flex items-center justify-between text-sm">
                  <Link href={`/dashboard/crm/deals/${deal.id}`} className="hover:underline">
                    {deal.estimatedValue ?? "Affaire"}
                  </Link>
                  <Badge>{deal.status}</Badge>
                </li>
              ))}
            </ul>
          </div>
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
                className="rounded-md border border-zinc-300 px-2 py-2 text-sm"
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
