"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContactSchema,
  updateContactSchema,
  type CreateContactInput,
  type UpdateContactInput,
} from "@korva/validation";
import { CONTACT_TYPES } from "@korva/types";
import type { Contact, CustomFieldValues } from "@korva/types";
import { Badge, Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { CustomFieldsFieldset } from "@/components/custom-fields-fieldset";
import { useT } from "@/lib/dashboard-locale";

export default function ContactsPage() {
  const t = useT();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const { data: contactsPage, isLoading } = useQuery({
    queryKey: ["contacts", "list", search, page],
    queryFn: () =>
      apiClient.getList<Contact>(
        `/contacts?page=${page}${search ? `&search=${encodeURIComponent(search)}` : ""}`,
      ),
    enabled: authReady,
  });
  const data = contactsPage?.data;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreateContactInput>({
    resolver: zodResolver(createContactSchema),
    defaultValues: { type: "person", tags: [] },
  });
  const createType = watch("type");
  // firstName/lastName mount by default (type starts as "person") and register as "" — an
  // untouched RHF text field's default value, not undefined. react-hook-form keeps that "" in
  // its internal state even after the fields unmount on switching to "company" (shouldUnregister
  // defaults to false), and createContactSchema's `.min(1).optional()` rejects "" (only
  // `undefined` satisfies `.optional()`) — so without this, switching to "Entreprise" without
  // ever touching Prénom/Nom silently blocks submission with no visible error. Explicitly
  // clearing them to undefined on switch keeps the schema's optional check meaningful.
  useEffect(() => {
    if (createType === "company") {
      setValue("firstName", undefined);
      setValue("lastName", undefined);
    }
  }, [createType, setValue]);

  const [createCustomFields, setCreateCustomFields] = useState<CustomFieldValues>({});
  const createMutation = useMutation({
    mutationFn: (input: CreateContactInput) => apiClient.post<Contact>("/contacts", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      reset();
      setCreateCustomFields({});
      setShowForm(false);
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
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
  // Same fix as the create form above: clear firstName/lastName when switching an existing
  // contact to "company" mid-edit, so a stale person-name value never gets silently resubmitted
  // on (or block validation for) a contact that's now typed as a company.
  useEffect(() => {
    if (editType === "company") {
      setEditValue("firstName", undefined);
      setEditValue("lastName", undefined);
    }
  }, [editType, setEditValue]);

  function startEdit(contact: Contact) {
    setEditingId(contact.id);
    setEditTagsInput(contact.tags.join(", "));
    setEditCustomFields(contact.customFields ?? {});
    resetEditForm({
      type: contact.type,
      firstName: contact.firstName,
      lastName: contact.lastName,
      company: contact.company,
      email: contact.email,
      phone: contact.phone,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    resetEditForm();
  }

  // Non optimiste, comme les mutations F1/F2/F3 : la ligne affichée dérive toujours de
  // ["contacts", search] après refetch, jamais d'une copie locale — en cas d'erreur, les
  // valeurs saisies restent dans le formulaire (pas de reset), sans rollback à écrire.
  // onSuccess retourne (pas `void`) la promesse d'invalidateQueries pour que isPending
  // couvre tout le refetch, pas seulement le PATCH.
  const updateContactMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & UpdateContactInput) =>
      apiClient.patch<Contact>(`/contacts/${id}`, input),
    onSuccess: () => {
      setEditingId(null);
      resetEditForm();
      return queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
  });

  const [deletingConfirmId, setDeletingConfirmId] = useState<string | null>(null);

  // Same non-optimistic shape as updateContactMutation: the list is only ever the query's
  // data, so an error never leaves a phantom removal to roll back. Reset on both success and
  // error (not just success) — per spec, a failed delete (e.g. CONTACT_IN_USE) must return the
  // row to its normal "Supprimer" state rather than leaving it stuck on "Confirmer ?".
  const deleteContactMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiClient.delete<{ deleted: true }>(`/contacts/${id}`),
    onSuccess: () => {
      setDeletingConfirmId(null);
      return queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: () => setDeletingConfirmId(null),
  });

  function deleteErrorMessage(error: unknown): string {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          type="search"
          placeholder={t("Rechercher un contact...", "Search for a contact...")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="w-64"
        />
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? t("Annuler", "Cancel") : t("Nouveau contact", "New contact")}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) =>
            createMutation.mutate({ ...values, customFields: createCustomFields }),
          )}
          // Not migrated to <Card>: Card renders a <div>, and this wrapper is the <form>
          // element itself (it carries onSubmit) — swapping it would either drop form
          // semantics or require nesting an extra <div> inside the form that isn't there
          // today. Left as a native element with its existing classes (F2-B.7).
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <select
            className="col-span-2 rounded-md border border-border-input bg-surface px-3 py-2 text-sm"
            {...register("type")}
          >
            {CONTACT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type === "company" ? t("Entreprise", "Company") : t("Personne", "Person")}
              </option>
            ))}
          </select>
          {createType === "company" ? (
            <Input
              placeholder={t("Nom de l'entreprise", "Company name")}
              className="col-span-2"
              {...register("company", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
            />
          ) : (
            <>
              <Input placeholder={t("Prénom", "First name")} {...register("firstName", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
              <Input placeholder={t("Nom", "Name")} {...register("lastName", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
            </>
          )}
          <Input placeholder={t("Email", "Email")} type="email" error={!!errors.email} {...register("email")} />
          {errors.email && <p className="col-span-2 text-xs text-destructive">{errors.email.message}</p>}
          <Input placeholder={t("Téléphone", "Phone")} {...register("phone", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
          {createType !== "company" && (
            <Input placeholder={t("Entreprise", "Company")} className="col-span-2" {...register("company", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
          )}
          <CustomFieldsFieldset
            entity="contacts"
            values={createCustomFields}
            onChange={setCreateCustomFields}
            idPrefix="contact-create"
          />
          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {createMutation.error instanceof ApiError ? createMutation.error.message : t("Erreur", "Error")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer le contact", "Create the contact")}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">{t("Nom", "Name")}</th>
                <th className="px-4 py-2">{t("Email", "Email")}</th>
                <th className="px-4 py-2">{t("Téléphone", "Phone")}</th>
                <th className="px-4 py-2">{t("Tags", "Tags")}</th>
                <th className="px-4 py-2">{t("Actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    {t("Chargement...", "Loading...")}
                  </td>
                </tr>
              )}
              {!isLoading && data?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    {t("Aucun contact.", "No contacts.")}
                  </td>
                </tr>
              )}
              {data?.map((contact) => {
                const isEditing = editingId === contact.id;
                const isThisPending =
                  updateContactMutation.isPending &&
                  updateContactMutation.variables?.id === contact.id;
                const editError =
                  updateContactMutation.isError &&
                  updateContactMutation.variables?.id === contact.id
                    ? updateContactMutation.error
                    : null;
                const isDeleteConfirming = deletingConfirmId === contact.id;
                const isDeletePending =
                  deleteContactMutation.isPending &&
                  deleteContactMutation.variables?.id === contact.id;
                const deleteError =
                  deleteContactMutation.isError &&
                  deleteContactMutation.variables?.id === contact.id
                    ? deleteContactMutation.error
                    : null;
                return (
                  <Fragment key={contact.id}>
                    <tr>
                      <td className="px-4 py-2 font-medium">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/dashboard/crm/${contact.id}`}
                            className="text-text underline-offset-2 hover:underline"
                          >
                            {[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
                              contact.company ||
                              "—"}
                          </Link>
                          {contact.type === "company" && <Badge>{t("Entreprise", "Company")}</Badge>}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-text-muted">{contact.email ?? "—"}</td>
                      <td className="px-4 py-2 text-text-muted">{contact.phone ?? "—"}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {contact.tags.map((tag) => (
                            <Badge key={tag}>{tag}</Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={isDeleteConfirming}
                            onClick={() => (isEditing ? cancelEdit() : startEdit(contact))}
                          >
                            {isEditing ? t("Annuler", "Cancel") : t("Modifier", "Edit")}
                          </Button>
                          {isDeleteConfirming ? (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={isDeletePending}
                                onClick={() =>
                                  deleteContactMutation.mutate({ id: contact.id })
                                }
                              >
                                {isDeletePending ? t("Suppression...", "Deleting...") : t("Confirmer ?", "Confirm?")}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isDeletePending}
                                onClick={() => setDeletingConfirmId(null)}
                              >
                                {t("Annuler", "Cancel")}
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isEditing}
                              onClick={() => setDeletingConfirmId(contact.id)}
                            >
                              {t("Supprimer", "Delete")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {deleteError && (
                      <tr>
                        <td colSpan={5} className="px-4 pb-2 text-xs text-destructive">
                          {deleteErrorMessage(deleteError)}
                        </td>
                      </tr>
                    )}
                    {isEditing && (
                      <tr>
                        <td colSpan={5} className="px-4 pb-4">
                          <form
                            onSubmit={handleEditSubmit((values) =>
                              updateContactMutation.mutate({
                                id: contact.id,
                                ...values,
                                tags: editTagsInput
                                  .split(",")
                                  .map((tag) => tag.trim())
                                  .filter(Boolean),
                                customFields: editCustomFields,
                              }),
                            )}
                            className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
                          >
                            <div className="col-span-2">
                              <label
                                className="mb-1 block text-xs font-medium text-text"
                                htmlFor={`edit-type-${contact.id}`}
                              >
                                {t("Type", "Type")}
                              </label>
                              <select
                                id={`edit-type-${contact.id}`}
                                className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm"
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
                                  htmlFor={`edit-company-name-${contact.id}`}
                                >
                                  {t("Nom de l'entreprise", "Company name")}
                                </label>
                                <Input
                                  id={`edit-company-name-${contact.id}`}
                                  className="w-full"
                                  {...registerEdit("company", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
                                />
                              </div>
                            ) : (
                              <>
                                <div>
                                  <label
                                    className="mb-1 block text-xs font-medium text-text"
                                    htmlFor={`edit-firstName-${contact.id}`}
                                  >
                                    {t("Prénom", "First name")}
                                  </label>
                                  <Input id={`edit-firstName-${contact.id}`} {...registerEdit("firstName", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
                                </div>
                                <div>
                                  <label
                                    className="mb-1 block text-xs font-medium text-text"
                                    htmlFor={`edit-lastName-${contact.id}`}
                                  >
                                    {t("Nom", "Name")}
                                  </label>
                                  <Input id={`edit-lastName-${contact.id}`} {...registerEdit("lastName", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
                                </div>
                              </>
                            )}
                            <div>
                              <label
                                className="mb-1 block text-xs font-medium text-text"
                                htmlFor={`edit-email-${contact.id}`}
                              >
                                {t("Email", "Email")}
                              </label>
                              <Input
                                id={`edit-email-${contact.id}`}
                                type="email"
                                error={!!editErrors.email}
                                {...registerEdit("email")}
                              />
                              {editErrors.email && (
                                <p className="mt-1 text-xs text-destructive">{editErrors.email.message}</p>
                              )}
                            </div>
                            <div>
                              <label
                                className="mb-1 block text-xs font-medium text-text"
                                htmlFor={`edit-phone-${contact.id}`}
                              >
                                {t("Téléphone", "Phone")}
                              </label>
                              <Input id={`edit-phone-${contact.id}`} {...registerEdit("phone", { setValueAs: (v: string) => (v === "" ? undefined : v) })} />
                            </div>
                            {editType !== "company" && (
                              <div className="col-span-2">
                                <label
                                  className="mb-1 block text-xs font-medium text-text"
                                  htmlFor={`edit-company-${contact.id}`}
                                >
                                  {t("Entreprise", "Company")}
                                </label>
                                <Input
                                  id={`edit-company-${contact.id}`}
                                  className="w-full"
                                  {...registerEdit("company", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
                                />
                              </div>
                            )}
                            <div className="col-span-2">
                              <label
                                className="mb-1 block text-xs font-medium text-text"
                                htmlFor={`edit-tags-${contact.id}`}
                              >
                                {t("Tags (séparés par des virgules)", "Tags (comma-separated)")}
                              </label>
                              <Input
                                id={`edit-tags-${contact.id}`}
                                className="w-full"
                                value={editTagsInput}
                                onChange={(e) => setEditTagsInput(e.target.value)}
                              />
                            </div>

                            <CustomFieldsFieldset
                              entity="contacts"
                              values={editCustomFields}
                              onChange={setEditCustomFields}
                              idPrefix={`contact-edit-${contact.id}`}
                            />

                            {editError && (
                              <p className="col-span-2 text-sm text-destructive">
                                {editError instanceof ApiError
                                  ? editError.message
                                  : t(
                                    "Impossible d'enregistrer le contact.",
                                    "The contact could not be saved.",
                                  )}
                              </p>
                            )}

                            <div className="col-span-2 flex gap-2">
                              <Button type="submit" loading={isThisPending}>
                                {isThisPending ? t("Enregistrement...", "Saving...") : t("Enregistrer", "Save")}
                              </Button>
                              <Button type="button" variant="ghost" onClick={cancelEdit}>
                                {t("Annuler", "Cancel")}
                              </Button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Pagination
        page={page}
        totalPages={contactsPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
