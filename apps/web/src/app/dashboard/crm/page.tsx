"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContactSchema, type CreateContactInput } from "@korva/validation";
import type { Contact } from "@korva/types";
import { apiClient, ApiError } from "@/lib/api-client";

export default function ContactsPage() {
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["contacts", search],
    queryFn: () =>
      apiClient.get<Contact[]>(`/contacts?${search ? `search=${encodeURIComponent(search)}` : ""}`),
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          placeholder="Rechercher un contact..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-zinc-900 focus:outline-none"
        />
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          {showForm ? "Annuler" : "Nouveau contact"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <input
            placeholder="Prénom"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("firstName")}
          />
          <input
            placeholder="Nom"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("lastName")}
          />
          <input
            placeholder="Email"
            type="email"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("email")}
          />
          {errors.email && <p className="col-span-2 text-xs text-red-600">{errors.email.message}</p>}
          <input
            placeholder="Téléphone"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("phone")}
          />
          <input
            placeholder="Entreprise"
            className="col-span-2 rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("company")}
          />
          {createMutation.isError && (
            <p className="col-span-2 text-sm text-red-600">
              {createMutation.error instanceof ApiError ? createMutation.error.message : "Erreur"}
            </p>
          )}
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="col-span-2 rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {createMutation.isPending ? "Création..." : "Créer le contact"}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Téléphone</th>
              <th className="px-4 py-2">Tags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  Chargement...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  Aucun contact.
                </td>
              </tr>
            )}
            {data?.map((contact) => (
              <tr key={contact.id}>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
