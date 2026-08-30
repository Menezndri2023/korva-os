"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createActivitySchema,
  createNoteSchema,
  createTaskSchema,
  updateContactSchema,
  type CreateActivityInput,
  type CreateNoteInput,
  type CreateTaskInput,
  type UpdateContactInput,
} from "@korva/validation";
import { ACTIVITY_TYPES, CONTACT_TYPES } from "@korva/types";
import type {
  Activity,
  Booking,
  BusinessGraphTimelineEntry,
  Cart,
  Contact,
  Conversation,
  ContactTimeline,
  Invoice,
  Lead,
  Note,
  Order,
  Quote,
  Task,
} from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { formatCurrency } from "@/lib/analytics-format";
import { RelationSection } from "@/components/relation-section";

const TIMELINE_TYPE_LABELS: Record<BusinessGraphTimelineEntry["type"], string> = {
  lead: "Prospect",
  quote: "Devis",
  invoice: "Facture",
  payment: "Paiement",
  booking: "Réservation",
  order: "Commande",
  conversation: "Conversation",
  task: "Tâche",
};

function contactDisplayName(contact: Contact): string {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.company ||
    "—"
  );
}

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "CONTACT_IN_USE") {
      return "Ce contact ne peut pas être supprimé car il est encore utilisé par d'autres éléments de votre organisation.";
    }
    return error.message;
  }
  return "Impossible de supprimer le contact.";
}

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const contactQuery = useQuery({
    queryKey: ["contacts", id],
    queryFn: () => apiClient.get<Contact>(`/contacts/${id}`),
    enabled: authReady,
  });

  const leadsQuery = useQuery({
    queryKey: ["leads", "contact", id],
    queryFn: () => apiClient.get<Lead[]>(`/leads?contactId=${id}`),
    enabled: authReady,
  });
  const ordersQuery = useQuery({
    queryKey: ["orders", "contact", id],
    queryFn: () => apiClient.get<Order[]>(`/orders?contactId=${id}`),
    enabled: authReady,
  });
  const cartsQuery = useQuery({
    queryKey: ["carts", "contact", id],
    queryFn: () => apiClient.get<Cart[]>(`/carts?contactId=${id}`),
    enabled: authReady,
  });
  const bookingsQuery = useQuery({
    queryKey: ["bookings", "contact", id],
    queryFn: () => apiClient.get<Booking[]>(`/bookings?contactId=${id}`),
    enabled: authReady,
  });
  const invoicesQuery = useQuery({
    queryKey: ["invoices", "contact", id],
    queryFn: () => apiClient.get<Invoice[]>(`/invoices?contactId=${id}`),
    enabled: authReady,
  });
  const quotesQuery = useQuery({
    queryKey: ["quotes", "contact", id],
    queryFn: () => apiClient.get<Quote[]>(`/quotes?contactId=${id}`),
    enabled: authReady,
  });
  const conversationsQuery = useQuery({
    queryKey: ["conversations", "contact", id],
    queryFn: () => apiClient.get<Conversation[]>(`/conversations?contactId=${id}`),
    enabled: authReady,
  });
  const notesQuery = useQuery({
    queryKey: ["notes", "contact", id],
    queryFn: () => apiClient.get<Note[]>(`/notes?entity=contact&entityId=${id}`),
    enabled: authReady,
  });
  const tasksQuery = useQuery({
    queryKey: ["tasks", "contact", id],
    queryFn: () => apiClient.get<Task[]>(`/tasks?entity=contact&entityId=${id}`),
    enabled: authReady,
  });
  const activitiesQuery = useQuery({
    queryKey: ["activities", "contact", id],
    queryFn: () => apiClient.get<Activity[]>(`/activities?entity=contact&entityId=${id}`),
    enabled: authReady,
  });
  const timelineQuery = useQuery({
    queryKey: ["business-graph", "contact-timeline", id],
    queryFn: () =>
      apiClient.get<ContactTimeline>(`/business-graph/contacts/${id}/timeline`),
    select: (timeline) => timeline.entries,
    enabled: authReady,
  });

  const {
    register: registerNote,
    handleSubmit: handleNoteSubmit,
    reset: resetNoteForm,
    formState: { errors: noteErrors },
  } = useForm<CreateNoteInput>({
    resolver: zodResolver(createNoteSchema),
    defaultValues: { entity: "contact", entityId: id, content: "" },
  });
  const createNoteMutation = useMutation({
    mutationFn: (input: CreateNoteInput) => apiClient.post<Note>("/notes", input),
    onSuccess: () => {
      resetNoteForm({ entity: "contact", entityId: id, content: "" });
      return queryClient.invalidateQueries({ queryKey: ["notes", "contact", id] });
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
    defaultValues: { entity: "contact", entityId: id, title: "" },
  });
  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => apiClient.post<Task>("/tasks", input),
    onSuccess: () => {
      resetTaskForm({ entity: "contact", entityId: id, title: "" });
      setTaskDueAt("");
      return queryClient.invalidateQueries({ queryKey: ["tasks", "contact", id] });
    },
  });
  const completeTaskMutation = useMutation({
    mutationFn: (taskId: string) => apiClient.patch<Task>(`/tasks/${taskId}`, { status: "done" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks", "contact", id] }),
  });

  const {
    register: registerActivity,
    handleSubmit: handleActivitySubmit,
    reset: resetActivityForm,
  } = useForm<CreateActivityInput>({
    resolver: zodResolver(createActivitySchema),
    defaultValues: { entity: "contact", entityId: id, type: "note", content: "" },
  });
  const createActivityMutation = useMutation({
    mutationFn: (input: CreateActivityInput) => apiClient.post<Activity>("/activities", input),
    onSuccess: () => {
      resetActivityForm({ entity: "contact", entityId: id, type: "note", content: "" });
      return queryClient.invalidateQueries({ queryKey: ["activities", "contact", id] });
    },
  });

  const [isEditing, setIsEditing] = useState(false);
  const [editTagsInput, setEditTagsInput] = useState("");
  const {
    register: registerEdit,
    handleSubmit: handleEditSubmit,
    reset: resetEditForm,
    watch: watchEdit,
    setValue: setEditValue,
    formState: { errors: editErrors },
  } = useForm<UpdateContactInput>({ resolver: zodResolver(updateContactSchema) });
  const editType = watchEdit("type");
  // Switching an existing person contact to "company" mid-edit would otherwise leave its
  // firstName/lastName registered with their real (non-empty) prior values even after the
  // fields unmount (react-hook-form's shouldUnregister defaults to false) — clearing them keeps
  // a converted-to-company contact from silently keeping a stale person name.
  useEffect(() => {
    if (editType === "company") {
      setEditValue("firstName", undefined);
      setEditValue("lastName", undefined);
    }
  }, [editType, setEditValue]);

  function startEdit(contact: Contact) {
    setIsEditing(true);
    setEditTagsInput(contact.tags.join(", "));
    resetEditForm({
      type: contact.type,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      email: contact.email,
      phone: contact.phone,
      defaultHourlyRate: contact.defaultHourlyRate,
    });
  }
  function cancelEdit() {
    setIsEditing(false);
    resetEditForm();
  }

  // Non optimiste, comme partout ailleurs (F1-F6) : les données affichées dérivent toujours
  // des queries après refetch, jamais d'une copie locale.
  const updateContactMutation = useMutation({
    mutationFn: (input: UpdateContactInput) =>
      apiClient.patch<Contact>(`/contacts/${id}`, input),
    onSuccess: () => {
      setIsEditing(false);
      resetEditForm();
      return queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });

  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const deleteContactMutation = useMutation({
    mutationFn: () => apiClient.delete<{ deleted: true }>(`/contacts/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["contacts"] });
      router.push("/dashboard/crm");
    },
    onError: () => setDeleteConfirming(false),
  });

  if (contactQuery.isLoading) {
    return <p className="text-sm text-text-muted">Chargement...</p>;
  }

  if (contactQuery.isError || !contactQuery.data) {
    const error = contactQuery.error;
    const message =
      error instanceof ApiError ? error.message : "Impossible de charger ce contact.";
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/crm"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          Retour aux contacts
        </Link>
      </Card>
    );
  }

  const contact = contactQuery.data;

  return (
    <div className="space-y-4">
      <Link href="/dashboard/crm" className="text-sm text-text-muted hover:underline">
        ← Contacts
      </Link>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{contactDisplayName(contact)}</h1>
            {contact.type === "company" && <Badge>Entreprise</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={deleteConfirming}
              onClick={() => (isEditing ? cancelEdit() : startEdit(contact))}
            >
              {isEditing ? "Annuler" : "Modifier"}
            </Button>
            {deleteConfirming ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={deleteContactMutation.isPending}
                  onClick={() => deleteContactMutation.mutate()}
                >
                  {deleteContactMutation.isPending ? "Suppression..." : "Confirmer ?"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteContactMutation.isPending}
                  onClick={() => setDeleteConfirming(false)}
                >
                  Annuler
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={isEditing}
                onClick={() => setDeleteConfirming(true)}
              >
                Supprimer
              </Button>
            )}
          </div>
        </div>

        {deleteContactMutation.isError && (
          <p className="mt-3 text-sm text-destructive">
            {deleteErrorMessage(deleteContactMutation.error)}
          </p>
        )}

        {!isEditing ? (
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-text-muted">Email</dt>
              <dd className="mt-0.5">{contact.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Téléphone</dt>
              <dd className="mt-0.5">{contact.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">
                {contact.type === "company" ? "Nom de l'entreprise" : "Entreprise (employeur)"}
              </dt>
              <dd className="mt-0.5">{contact.company ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Tags</dt>
              <dd className="mt-0.5 flex flex-wrap gap-1">
                {contact.tags.length === 0
                  ? "—"
                  : contact.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Taux horaire par défaut</dt>
              <dd className="mt-0.5">
                {contact.defaultHourlyRate != null ? `${contact.defaultHourlyRate}/h` : "—"}
              </dd>
            </div>
          </dl>
        ) : (
          <form
            onSubmit={handleEditSubmit((values) =>
              updateContactMutation.mutate({
                ...values,
                tags: editTagsInput
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              }),
            )}
            className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4"
          >
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-700" htmlFor="type">
                Type
              </label>
              <select
                id="type"
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm"
                {...registerEdit("type")}
              >
                {CONTACT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === "company" ? "Entreprise" : "Personne"}
                  </option>
                ))}
              </select>
            </div>
            {editType === "company" ? (
              <div className="col-span-2">
                <label
                  className="mb-1 block text-xs font-medium text-zinc-700"
                  htmlFor="company-name"
                >
                  Nom de l&apos;entreprise
                </label>
                <Input id="company-name" className="w-full" {...registerEdit("company")} />
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700" htmlFor="firstName">
                    Prénom
                  </label>
                  <Input id="firstName" {...registerEdit("firstName")} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-700" htmlFor="lastName">
                    Nom
                  </label>
                  <Input id="lastName" {...registerEdit("lastName")} />
                </div>
              </>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-700" htmlFor="email">
                Email
              </label>
              <Input
                id="email"
                type="email"
                error={!!editErrors.email}
                {...registerEdit("email")}
              />
              {editErrors.email && (
                <p className="mt-1 text-xs text-red-600">{editErrors.email.message}</p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-700" htmlFor="phone">
                Téléphone
              </label>
              <Input id="phone" {...registerEdit("phone")} />
            </div>
            {editType !== "company" && (
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-zinc-700" htmlFor="company">
                  Entreprise
                </label>
                <Input id="company" className="w-full" {...registerEdit("company")} />
              </div>
            )}
            <div>
              <label
                className="mb-1 block text-xs font-medium text-zinc-700"
                htmlFor="defaultHourlyRate"
              >
                Taux horaire par défaut
              </label>
              <Input
                id="defaultHourlyRate"
                type="number"
                step="0.01"
                placeholder="Ex. 120"
                {...registerEdit("defaultHourlyRate", {
                  setValueAs: (value: string) => (value === "" ? undefined : Number(value)),
                })}
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-zinc-700" htmlFor="tags">
                Tags (séparés par des virgules)
              </label>
              <Input
                id="tags"
                className="w-full"
                value={editTagsInput}
                onChange={(e) => setEditTagsInput(e.target.value)}
              />
            </div>

            {updateContactMutation.isError && (
              <p className="col-span-2 text-sm text-red-600">
                {updateContactMutation.error instanceof ApiError
                  ? updateContactMutation.error.message
                  : "Impossible d'enregistrer le contact."}
              </p>
            )}

            <div className="col-span-2 flex gap-2">
              <Button type="submit" loading={updateContactMutation.isPending}>
                {updateContactMutation.isPending ? "Enregistrement..." : "Enregistrer"}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEdit}>
                Annuler
              </Button>
            </div>
          </form>
        )}
      </Card>

      <RelationSection<BusinessGraphTimelineEntry>
        title="Chronologie"
        query={timelineQuery}
        emptyLabel="Aucun événement pour ce contact."
        renderItem={(entry) => (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge>{TIMELINE_TYPE_LABELS[entry.type]}</Badge>
              <span>{entry.summary}</span>
            </div>
            <div className="flex items-center gap-3 text-text-muted">
              {entry.amount != null && entry.currency && (
                <span>{formatCurrency(entry.amount, entry.currency)}</span>
              )}
              <span>{new Date(entry.occurredAt).toLocaleDateString("fr-FR")}</span>
            </div>
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RelationSection<Lead>
          title="Prospects"
          query={leadsQuery}
          emptyLabel="Aucun prospect."
          renderItem={(lead) => (
            <div className="flex items-center justify-between">
              <Badge>{lead.status}</Badge>
              {lead.estimatedValue != null && <span>{lead.estimatedValue}</span>}
            </div>
          )}
        />
        <RelationSection<Order>
          title="Commandes"
          query={ordersQuery}
          emptyLabel="Aucune commande."
          renderItem={(order) => (
            <div className="flex items-center justify-between">
              <span>{order.number}</span>
              <Badge>{order.status}</Badge>
              <span>{formatCurrency(order.total, order.currency)}</span>
            </div>
          )}
        />
        <RelationSection<Booking>
          title="Réservations"
          query={bookingsQuery}
          emptyLabel="Aucune réservation."
          renderItem={(booking) => (
            <div className="flex items-center justify-between">
              <span>{new Date(booking.startAt).toLocaleString("fr-FR")}</span>
              <Badge>{booking.status}</Badge>
            </div>
          )}
        />
        <RelationSection<Invoice>
          title="Factures"
          query={invoicesQuery}
          emptyLabel="Aucune facture."
          renderItem={(invoice) => (
            <div className="flex items-center justify-between">
              <span>{invoice.number}</span>
              <Badge>{invoice.status}</Badge>
              <span>{formatCurrency(invoice.total, invoice.currency)}</span>
            </div>
          )}
        />
        <RelationSection<Quote>
          title="Devis"
          query={quotesQuery}
          emptyLabel="Aucun devis."
          renderItem={(quote) => (
            <div className="flex items-center justify-between">
              <span>{quote.number}</span>
              <Badge>{quote.status}</Badge>
              <span>{formatCurrency(quote.total, quote.currency)}</span>
            </div>
          )}
        />
        <RelationSection<Cart>
          title="Paniers"
          query={cartsQuery}
          emptyLabel="Aucun panier."
          renderItem={(cart) => (
            <div className="flex items-center justify-between">
              <Badge>{cart.status}</Badge>
              <span>
                {cart.items.length} article{cart.items.length > 1 ? "s" : ""}
              </span>
            </div>
          )}
        />
        <RelationSection<Conversation>
          title="Conversations"
          query={conversationsQuery}
          emptyLabel="Aucune conversation."
          renderItem={(conversation) => (
            <div className="flex items-center justify-between">
              <span>{conversation.subject ?? conversation.channel}</span>
              <Badge>{conversation.status}</Badge>
            </div>
          )}
        />
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
