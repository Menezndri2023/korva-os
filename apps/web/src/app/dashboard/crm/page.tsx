"use client";

import { Fragment, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContactSchema,
  updateContactSchema,
  type CreateContactInput,
  type UpdateContactInput,
} from "@korva/validation";
import type { Contact } from "@korva/types";
import { Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

export default function ContactsPage() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const { data, isLoading } = useQuery({
    queryKey: ["contacts", search],
    queryFn: () =>
      apiClient.get<Contact[]>(`/contacts?${search ? `search=${encodeURIComponent(search)}` : ""}`),
    enabled: authReady,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateContactInput>({
    resolver: zodResolver(createContactSchema),
    defaultValues: { type: "person", tags: [] },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateContactInput) => apiClient.post<Contact>("/contacts", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["contacts"] });
      reset();
      setShowForm(false);
    },
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTagsInput, setEditTagsInput] = useState("");
  const {
    register: registerEdit,
    handleSubmit: handleEditSubmit,
    reset: resetEditForm,
    formState: { errors: editErrors },
  } = useForm<UpdateContactInput>({ resolver: zodResolver(updateContactSchema) });

  function startEdit(contact: Contact) {
    setEditingId(contact.id);
    setEditTagsInput(contact.tags.join(", "));
    resetEditForm({
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          type="search"
          placeholder="Rechercher un contact..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouveau contact"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          // Not migrated to <Card>: Card renders a <div>, and this wrapper is the <form>
          // element itself (it carries onSubmit) — swapping it would either drop form
          // semantics or require nesting an extra <div> inside the form that isn't there
          // today. Left as a native element with its existing classes (F2-B.7).
          className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <Input placeholder="Prénom" {...register("firstName")} />
          <Input placeholder="Nom" {...register("lastName")} />
          <Input placeholder="Email" type="email" error={!!errors.email} {...register("email")} />
          {errors.email && <p className="col-span-2 text-xs text-red-600">{errors.email.message}</p>}
          <Input placeholder="Téléphone" {...register("phone")} />
          <Input placeholder="Entreprise" className="col-span-2" {...register("company")} />
          {createMutation.isError && (
            <p className="col-span-2 text-sm text-red-600">
              {createMutation.error instanceof ApiError ? createMutation.error.message : "Erreur"}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? "Création..." : "Créer le contact"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Téléphone</th>
              <th className="px-4 py-2">Tags</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                  Chargement...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                  Aucun contact.
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
              return (
                <Fragment key={contact.id}>
                  <tr>
                    <td className="px-4 py-2 font-medium">
                      {[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
                        contact.company ||
                        "—"}
                    </td>
                    <td className="px-4 py-2 text-zinc-600">{contact.email ?? "—"}</td>
                    <td className="px-4 py-2 text-zinc-600">{contact.phone ?? "—"}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {contact.tags.map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => (isEditing ? cancelEdit() : startEdit(contact))}
                      >
                        {isEditing ? "Annuler" : "Modifier"}
                      </Button>
                    </td>
                  </tr>
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
                            }),
                          )}
                          className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4"
                        >
                          <div>
                            <label
                              className="mb-1 block text-xs font-medium text-zinc-700"
                              htmlFor={`edit-firstName-${contact.id}`}
                            >
                              Prénom
                            </label>
                            <Input id={`edit-firstName-${contact.id}`} {...registerEdit("firstName")} />
                          </div>
                          <div>
                            <label
                              className="mb-1 block text-xs font-medium text-zinc-700"
                              htmlFor={`edit-lastName-${contact.id}`}
                            >
                              Nom
                            </label>
                            <Input id={`edit-lastName-${contact.id}`} {...registerEdit("lastName")} />
                          </div>
                          <div>
                            <label
                              className="mb-1 block text-xs font-medium text-zinc-700"
                              htmlFor={`edit-email-${contact.id}`}
                            >
                              Email
                            </label>
                            <Input
                              id={`edit-email-${contact.id}`}
                              type="email"
                              error={!!editErrors.email}
                              {...registerEdit("email")}
                            />
                            {editErrors.email && (
                              <p className="mt-1 text-xs text-red-600">{editErrors.email.message}</p>
                            )}
                          </div>
                          <div>
                            <label
                              className="mb-1 block text-xs font-medium text-zinc-700"
                              htmlFor={`edit-phone-${contact.id}`}
                            >
                              Téléphone
                            </label>
                            <Input id={`edit-phone-${contact.id}`} {...registerEdit("phone")} />
                          </div>
                          <div className="col-span-2">
                            <label
                              className="mb-1 block text-xs font-medium text-zinc-700"
                              htmlFor={`edit-company-${contact.id}`}
                            >
                              Entreprise
                            </label>
                            <Input
                              id={`edit-company-${contact.id}`}
                              className="w-full"
                              {...registerEdit("company")}
                            />
                          </div>
                          <div className="col-span-2">
                            <label
                              className="mb-1 block text-xs font-medium text-zinc-700"
                              htmlFor={`edit-tags-${contact.id}`}
                            >
                              Tags (séparés par des virgules)
                            </label>
                            <Input
                              id={`edit-tags-${contact.id}`}
                              className="w-full"
                              value={editTagsInput}
                              onChange={(e) => setEditTagsInput(e.target.value)}
                            />
                          </div>

                          {editError && (
                            <p className="col-span-2 text-sm text-red-600">
                              {editError instanceof ApiError
                                ? editError.message
                                : "Impossible d'enregistrer le contact."}
                            </p>
                          )}

                          <div className="col-span-2 flex gap-2">
                            <Button type="submit" loading={isThisPending}>
                              {isThisPending ? "Enregistrement..." : "Enregistrer"}
                            </Button>
                            <Button type="button" variant="ghost" onClick={cancelEdit}>
                              Annuler
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
      </Card>
    </div>
  );
}
