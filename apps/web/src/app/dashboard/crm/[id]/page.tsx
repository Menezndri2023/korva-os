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
  CreditBalance,
  CustomFieldValues,
  Deal,
  Invoice,
  Lead,
  Note,
  Offer,
  Order,
  Quote,
  Task,
} from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import {
  DEAL_STATUS_LABELS,
  DEAL_STATUS_LABELS_EN,
  formatCurrency,
  labelIn,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_LABELS_EN,
} from "@/lib/analytics-format";
import { intlLocale, useDashboardLocale, useT, type Translate } from "@/lib/dashboard-locale";
import { RelationSection } from "@/components/relation-section";
import { ContactAccountCard } from "@/components/customer-account-actions";
import { CustomFieldsDisplay } from "@/components/custom-fields-display";
import { CustomFieldsFieldset } from "@/components/custom-fields-fieldset";
import { ContactLoyaltyCard } from "@/components/loyalty";

const TIMELINE_TYPE_LABELS: Record<BusinessGraphTimelineEntry["type"], [string, string]> = {
  lead: ["Prospect", "Lead"],
  deal: ["Affaire", "Deal"],
  quote: ["Devis", "Quote"],
  invoice: ["Facture", "Invoice"],
  payment: ["Paiement", "Payment"],
  booking: ["Réservation", "Booking"],
  order: ["Commande", "Order"],
  conversation: ["Conversation", "Conversation"],
  task: ["Tâche", "Task"],
};

function contactDisplayName(contact: Contact): string {
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
    contact.company ||
    "—"
  );
}

function deleteErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.code === "CONTACT_IN_USE") {
      return t(
        "Ce contact ne peut pas être supprimé car il est encore utilisé par d'autres éléments de votre organisation.",
        "This contact cannot be deleted because other records in your organization still use it.",
      );
    }
    return error.message;
  }
  return t("Impossible de supprimer le contact.", "The contact could not be deleted.");
}

interface DuplicateContactGroup {
  field: "email" | "phone";
  value: string;
  contacts: Contact[];
}

function mergeErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.code === "CONTACT_MERGE_BOTH_HAVE_CUSTOMER_ACCOUNTS") {
      return t(
        "Fusion impossible : ces deux contacts ont chacun leur propre compte client. Supprimez ou transférez l'un des deux comptes avant de réessayer.",
        "These contacts cannot be merged: each has its own customer account. Delete or move one of the two accounts and try again.",
      );
    }
    return error.message;
  }
  return t("Impossible de fusionner ces contacts.", "These contacts could not be merged.");
}

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const locale = useDashboardLocale();
  const t = useT();

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
  const dealsQuery = useQuery({
    queryKey: ["deals", "contact", id],
    queryFn: () => apiClient.get<Deal[]>(`/deals?contactId=${id}`),
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
  const creditBalancesQuery = useQuery({
    queryKey: ["credit-balances", "contact", id],
    queryFn: () => apiClient.get<CreditBalance[]>(`/credit-balances?contactId=${id}`),
    enabled: authReady,
  });
  const { data: packageOffers } = useQuery({
    queryKey: ["offers", "package"],
    queryFn: () => apiClient.get<Offer[]>("/offers?type=package"),
    enabled: authReady,
  });
  function packageOfferName(offerId: string): string {
    return packageOffers?.find((o) => o.id === offerId)?.name ?? "—";
  }
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

  const duplicatesQuery = useQuery({
    queryKey: ["contacts", "duplicates"],
    queryFn: () => apiClient.get<DuplicateContactGroup[]>("/contacts/duplicates"),
    select: (groups) => {
      const candidates = new Map<string, Contact>();
      for (const group of groups) {
        if (!group.contacts.some((c) => c.id === id)) continue;
        for (const candidate of group.contacts) {
          if (candidate.id !== id) candidates.set(candidate.id, candidate);
        }
      }
      return Array.from(candidates.values());
    },
    enabled: authReady,
  });

  const [confirmMergeId, setConfirmMergeId] = useState<string | null>(null);
  const mergeContactMutation = useMutation({
    mutationFn: (duplicateContactId: string) =>
      apiClient.post<Contact>(`/contacts/${id}/merge`, { duplicateContactId }),
    onSuccess: async () => {
      setConfirmMergeId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["contacts"] }),
        queryClient.invalidateQueries({ queryKey: ["contacts", "duplicates"] }),
      ]);
    },
    onError: () => setConfirmMergeId(null),
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
  const [editCustomFields, setEditCustomFields] = useState<CustomFieldValues>({});
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
    setEditCustomFields(contact.customFields ?? {});
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
    return <p className="text-sm text-text-muted">{t("Chargement...", "Loading...")}</p>;
  }

  if (contactQuery.isError || !contactQuery.data) {
    const error = contactQuery.error;
    const message =
      error instanceof ApiError ? error.message : t(
        "Impossible de charger ce contact.",
        "This contact could not be loaded.",
      );
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/crm"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          {t("Retour aux contacts", "Back to contacts")}
        </Link>
      </Card>
    );
  }

  const contact = contactQuery.data;

  return (
    <div className="space-y-4">
      <Link href="/dashboard/crm" className="text-sm text-text-muted hover:underline">
        {t("← Contacts", "← Contacts")}
      </Link>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{contactDisplayName(contact)}</h1>
            {contact.type === "company" && <Badge>{t("Entreprise", "Company")}</Badge>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={deleteConfirming}
              onClick={() => (isEditing ? cancelEdit() : startEdit(contact))}
            >
              {isEditing ? t("Annuler", "Cancel") : t("Modifier", "Edit")}
            </Button>
            {deleteConfirming ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={deleteContactMutation.isPending}
                  onClick={() => deleteContactMutation.mutate()}
                >
                  {deleteContactMutation.isPending ? t("Suppression...", "Deleting...") : t("Confirmer ?", "Confirm?")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={deleteContactMutation.isPending}
                  onClick={() => setDeleteConfirming(false)}
                >
                  {t("Annuler", "Cancel")}
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={isEditing}
                onClick={() => setDeleteConfirming(true)}
              >
                {t("Supprimer", "Delete")}
              </Button>
            )}
          </div>
        </div>

        {deleteContactMutation.isError && (
          <p className="mt-3 text-sm text-destructive">
            {deleteErrorMessage(deleteContactMutation.error, t)}
          </p>
        )}

        {!isEditing ? (
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-text-muted">{t("Email", "Email")}</dt>
              <dd className="mt-0.5">{contact.email ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Téléphone", "Phone")}</dt>
              <dd className="mt-0.5">{contact.phone ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">
                {contact.type === "company" ? t("Nom de l'entreprise", "Company name") : t("Entreprise (employeur)", "Company (employer)")}
              </dt>
              <dd className="mt-0.5">{contact.company ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Tags", "Tags")}</dt>
              <dd className="mt-0.5 flex flex-wrap gap-1">
                {contact.tags.length === 0
                  ? "—"
                  : contact.tags.map((tag) => <Badge key={tag}>{tag}</Badge>)}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">{t("Taux horaire par défaut", "Default hourly rate")}</dt>
              <dd className="mt-0.5">
                {contact.defaultHourlyRate != null ? `${contact.defaultHourlyRate}/h` : "—"}
              </dd>
            </div>
            <CustomFieldsDisplay entity="contacts" values={contact.customFields} />
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
                customFields: editCustomFields,
              }),
            )}
            className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-white p-4"
          >
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="type">
                {t("Type", "Type")}
              </label>
              <select
                id="type"
                className="w-full rounded-md border border-border-input bg-white px-3 py-2 text-sm"
                {...registerEdit("type")}
              >
                {CONTACT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type === "company" ? t("Entreprise", "Company") : t("Personne", "Person")}
                  </option>
                ))}
              </select>
            </div>
            {editType === "company" ? (
              <div className="col-span-2">
                <label
                  className="mb-1 block text-xs font-medium text-text"
                  htmlFor="company-name"
                >
                  {t("Nom de l'entreprise", "Company name")}
                </label>
                <Input id="company-name" className="w-full" {...registerEdit("company", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
              </div>
            ) : (
              <>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text" htmlFor="firstName">
                    {t("Prénom", "First name")}
                  </label>
                  <Input id="firstName" {...registerEdit("firstName", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-text" htmlFor="lastName">
                    {t("Nom", "Name")}
                  </label>
                  <Input id="lastName" {...registerEdit("lastName", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
                </div>
              </>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="email">
                {t("Email", "Email")}
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
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="phone">
                {t("Téléphone", "Phone")}
              </label>
              <Input id="phone" {...registerEdit("phone", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
            </div>
            {editType !== "company" && (
              <div className="col-span-2">
                <label className="mb-1 block text-xs font-medium text-text" htmlFor="company">
                  {t("Entreprise", "Company")}
                </label>
                <Input id="company" className="w-full" {...registerEdit("company", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
              </div>
            )}
            <div>
              <label
                className="mb-1 block text-xs font-medium text-text"
                htmlFor="defaultHourlyRate"
              >
                {t("Taux horaire par défaut", "Default hourly rate")}
              </label>
              <Input
                id="defaultHourlyRate"
                type="number"
                step="0.01"
                placeholder={t("Ex. 120", "E.g. 120")}
                {...registerEdit("defaultHourlyRate", {
                  setValueAs: (value: string) => (value === "" ? undefined : Number(value)),
                })}
              />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-text" htmlFor="tags">
                {t("Tags (séparés par des virgules)", "Tags (comma-separated)")}
              </label>
              <Input
                id="tags"
                className="w-full"
                value={editTagsInput}
                onChange={(e) => setEditTagsInput(e.target.value)}
              />
            </div>

            <CustomFieldsFieldset
              entity="contacts"
              values={editCustomFields}
              onChange={setEditCustomFields}
              idPrefix="contact-edit"
            />

            {updateContactMutation.isError && (
              <p className="col-span-2 text-sm text-red-600">
                {updateContactMutation.error instanceof ApiError
                  ? updateContactMutation.error.message
                  : t("Impossible d'enregistrer le contact.", "The contact could not be saved.")}
              </p>
            )}

            <div className="col-span-2 flex gap-2">
              <Button type="submit" loading={updateContactMutation.isPending}>
                {updateContactMutation.isPending ? t("Enregistrement...", "Saving...") : t("Enregistrer", "Save")}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEdit}>
                {t("Annuler", "Cancel")}
              </Button>
            </div>
          </form>
        )}
      </Card>

      <ContactLoyaltyCard contactId={id} />

      {duplicatesQuery.data && duplicatesQuery.data.length > 0 && (
        <Card className="p-6">
          <h2 className="text-sm font-semibold">{t("Doublons potentiels", "Possible duplicates")}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {t(
              "Ces contacts partagent le même email ou téléphone. Fusionner conserve ce contact-ci comme fiche principale et reporte l'historique de l'autre dessus ; l'autre fiche est ensuite supprimée. Cette action est irréversible.",
              "These contacts share the same e-mail or phone. Merging keeps this contact as the main record and moves the other's history onto it; the other record is then deleted. This cannot be undone.",
            )}
          </p>
          <ul className="mt-4 space-y-3">
            {duplicatesQuery.data.map((candidate) => (
              <li
                key={candidate.id}
                className="flex items-center justify-between gap-4 rounded-md border border-border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{contactDisplayName(candidate)}</p>
                  <p className="text-sm text-text-muted">
                    {[candidate.email, candidate.phone].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                {confirmMergeId === candidate.id ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      loading={mergeContactMutation.isPending}
                      onClick={() => mergeContactMutation.mutate(candidate.id)}
                    >
                      {mergeContactMutation.isPending ? t("Fusion...", "Merging...") : t("Confirmer la fusion", "Confirm the merge")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={mergeContactMutation.isPending}
                      onClick={() => setConfirmMergeId(null)}
                    >
                      {t("Annuler", "Cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    onClick={() => setConfirmMergeId(candidate.id)}
                  >
                    {t("Fusionner", "Merge")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {mergeContactMutation.isError && (
            <p className="mt-3 text-sm text-destructive">
              {mergeErrorMessage(mergeContactMutation.error, t)}
            </p>
          )}
        </Card>
      )}

      <ContactAccountCard contactId={id} />

      <RelationSection<BusinessGraphTimelineEntry>
        title={t("Chronologie", "Timeline")}
        query={timelineQuery}
        emptyLabel={t("Aucun événement pour ce contact.", "No events for this contact.")}
        renderItem={(entry) => (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge>{t(...TIMELINE_TYPE_LABELS[entry.type])}</Badge>
              <span>{entry.summary}</span>
            </div>
            <div className="flex items-center gap-3 text-text-muted">
              {entry.amount != null && entry.currency && (
                <span>{formatCurrency(entry.amount, entry.currency, locale)}</span>
              )}
              <span>{new Date(entry.occurredAt).toLocaleDateString(intlLocale(locale))}</span>
            </div>
          </div>
        )}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <RelationSection<Lead>
          title={t("Prospects", "Leads")}
          query={leadsQuery}
          emptyLabel={t("Aucun prospect.", "No leads.")}
          renderItem={(lead) => (
            <div className="flex items-center justify-between">
              <Link href={`/dashboard/crm/leads/${lead.id}`} className="hover:underline">
                {lead.source ?? t("Prospect", "Lead")}
              </Link>
              <Badge>{labelIn(LEAD_STATUS_LABELS, LEAD_STATUS_LABELS_EN, lead.status, locale)}</Badge>
            </div>
          )}
        />
        <RelationSection<Deal>
          title={t("Affaires", "Deals")}
          query={dealsQuery}
          emptyLabel={t("Aucune affaire.", "No deals.")}
          renderItem={(deal) => (
            <div className="flex items-center justify-between">
              <Link href={`/dashboard/crm/deals/${deal.id}`} className="hover:underline">
                {deal.estimatedValue != null ? deal.estimatedValue : t("Affaire", "Deal")}
              </Link>
              <Badge>{labelIn(DEAL_STATUS_LABELS, DEAL_STATUS_LABELS_EN, deal.status, locale)}</Badge>
            </div>
          )}
        />
        <RelationSection<Order>
          title={t("Commandes", "Orders")}
          query={ordersQuery}
          emptyLabel={t("Aucune commande.", "No orders.")}
          renderItem={(order) => (
            <div className="flex items-center justify-between">
              <span>{order.number}</span>
              <Badge>{order.status}</Badge>
              <span>{formatCurrency(order.total, order.currency, locale)}</span>
            </div>
          )}
        />
        <RelationSection<Booking>
          title={t("Réservations", "Bookings")}
          query={bookingsQuery}
          emptyLabel={t("Aucune réservation.", "No bookings.")}
          renderItem={(booking) => (
            <div className="flex items-center justify-between">
              <span>{new Date(booking.startAt).toLocaleString(intlLocale(locale))}</span>
              <Badge>{booking.status}</Badge>
            </div>
          )}
        />
        <RelationSection<CreditBalance>
          title={t("Forfaits", "Packages")}
          query={creditBalancesQuery}
          emptyLabel={t("Aucun forfait.", "No packages.")}
          renderItem={(balance) => (
            <div className="flex items-center justify-between">
              <span>{packageOfferName(balance.offerId)}</span>
              <span>
                {balance.remainingCredits} / {balance.totalCredits} {t("séances", "sessions")}
              </span>
            </div>
          )}
        />
        <RelationSection<Invoice>
          title={t("Factures", "Invoices")}
          query={invoicesQuery}
          emptyLabel={t("Aucune facture.", "No invoices.")}
          renderItem={(invoice) => (
            <div className="flex items-center justify-between">
              <span>{invoice.number}</span>
              <Badge>{invoice.status}</Badge>
              <span>{formatCurrency(invoice.total, invoice.currency, locale)}</span>
            </div>
          )}
        />
        <RelationSection<Quote>
          title={t("Devis", "Quotes")}
          query={quotesQuery}
          emptyLabel={t("Aucun devis.", "No quotes.")}
          renderItem={(quote) => (
            <div className="flex items-center justify-between">
              <span>{quote.number}</span>
              <Badge>{quote.status}</Badge>
              <span>{formatCurrency(quote.total, quote.currency, locale)}</span>
            </div>
          )}
        />
        <RelationSection<Cart>
          title={t("Paniers", "Baskets")}
          query={cartsQuery}
          emptyLabel={t("Aucun panier.", "No baskets.")}
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
          title={t("Conversations", "Conversations")}
          query={conversationsQuery}
          emptyLabel={t("Aucune conversation.", "No conversations.")}
          renderItem={(conversation) => (
            <div className="flex items-center justify-between">
              <span>{conversation.subject ?? conversation.channel}</span>
              <Badge>{conversation.status}</Badge>
            </div>
          )}
        />
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
