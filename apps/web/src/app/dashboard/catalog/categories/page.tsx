"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCategorySchema,
  updateCategorySchema,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from "@korva/validation";
import type { Category } from "@korva/types";
import { Button, Card, Dialog, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "CATEGORY_IN_USE") {
      return "Cette catégorie est encore utilisée par une ou plusieurs offres et ne peut pas être supprimée.";
    }
    return error.message;
  }
  return "Impossible de supprimer la catégorie.";
}

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => apiClient.get<Category[]>("/categories"),
    enabled: authReady,
  });

  const createForm = useForm<CreateCategoryInput>({
    resolver: zodResolver(createCategorySchema),
    defaultValues: { name: "", description: "" },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateCategoryInput) => apiClient.post<Category>("/categories", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      createForm.reset();
      setIsCreateOpen(false);
    },
  });

  function closeCreateDialog() {
    setIsCreateOpen(false);
    createForm.reset();
  }

  const editForm = useForm<UpdateCategoryInput>({
    resolver: zodResolver(updateCategorySchema),
  });

  function startEdit(category: Category) {
    setEditingCategory(category);
    editForm.reset({ name: category.name, description: category.description });
  }
  function closeEditDialog() {
    setEditingCategory(null);
    editForm.reset();
  }

  const updateMutation = useMutation({
    mutationFn: (input: UpdateCategoryInput) => {
      if (!editingCategory) throw new Error("No category selected for editing");
      return apiClient.patch<Category>(`/categories/${editingCategory.id}`, input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["categories"] });
      closeEditDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!deletingCategory) throw new Error("No category selected for deletion");
      return apiClient.delete<{ deleted: true }>(`/categories/${deletingCategory.id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
      setDeletingCategory(null);
    },
    onError: () => setDeletingCategory(null),
  });

  const categories = categoriesQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-text-muted">
          Organisez votre catalogue en regroupant vos offres par catégorie.
        </p>
        <Button onClick={() => setIsCreateOpen(true)}>Nouvelle catégorie</Button>
      </div>

      {categoriesQuery.isError && (
        <Card className="p-6">
          <p className="text-sm text-destructive">Impossible de charger les catégories.</p>
          <button
            onClick={() => categoriesQuery.refetch()}
            className="mt-2 text-sm font-medium text-text underline"
          >
            Réessayer
          </button>
        </Card>
      )}

      {deleteMutation.isError && (
        <p className="text-sm text-destructive">{deleteErrorMessage(deleteMutation.error)}</p>
      )}

      {!categoriesQuery.isError && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
                <tr>
                  <th className="px-4 py-2">Nom</th>
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {categoriesQuery.isLoading && (
                  <tr>
                    <td colSpan={3} className="px-4 py-6 text-center text-text-muted">
                      Chargement...
                    </td>
                  </tr>
                )}
                {!categoriesQuery.isLoading && categories?.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-text-muted">
                      <p>Aucune catégorie pour le moment.</p>
                      <p className="mt-1 text-xs">
                        Les catégories vous permettent de regrouper vos offres pour mieux les
                        organiser et les retrouver. Créez votre première catégorie pour commencer.
                      </p>
                    </td>
                  </tr>
                )}
                {categories?.map((category) => (
                  <tr key={category.id}>
                    <td className="px-4 py-2 font-medium">{category.name}</td>
                    <td className="px-4 py-2 text-text-muted">{category.description ?? "—"}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" size="sm" onClick={() => startEdit(category)}>
                          Modifier
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeletingCategory(category)}
                        >
                          Supprimer
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Dialog open={isCreateOpen} onClose={closeCreateDialog} title="Nouvelle catégorie">
        <form
          onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3"
        >
          <Input placeholder="Nom" {...createForm.register("name")} />
          {createForm.formState.errors.name && (
            <p className="text-xs text-destructive">
              {createForm.formState.errors.name.message}
            </p>
          )}
          <textarea
            placeholder="Description"
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={3}
            {...createForm.register("description")}
          />
          {createForm.formState.errors.description && (
            <p className="text-xs text-destructive">
              {createForm.formState.errors.description.message}
            </p>
          )}

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof ApiError
                ? createMutation.error.message
                : "Impossible de créer la catégorie."}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeCreateDialog}>
              Annuler
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              {createMutation.isPending ? "Création..." : "Créer"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editingCategory !== null}
        onClose={closeEditDialog}
        title="Modifier la catégorie"
      >
        <form
          onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}
          className="space-y-3"
        >
          <Input placeholder="Nom" {...editForm.register("name")} />
          {editForm.formState.errors.name && (
            <p className="text-xs text-destructive">{editForm.formState.errors.name.message}</p>
          )}
          <textarea
            placeholder="Description"
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={3}
            {...editForm.register("description")}
          />
          {editForm.formState.errors.description && (
            <p className="text-xs text-destructive">
              {editForm.formState.errors.description.message}
            </p>
          )}

          {updateMutation.isError && (
            <p className="text-sm text-destructive">
              {updateMutation.error instanceof ApiError
                ? updateMutation.error.message
                : "Impossible d'enregistrer la catégorie."}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeEditDialog}>
              Annuler
            </Button>
            <Button type="submit" loading={updateMutation.isPending}>
              {updateMutation.isPending ? "Enregistrement..." : "Enregistrer"}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deletingCategory !== null}
        onClose={() => setDeletingCategory(null)}
        title="Supprimer la catégorie ?"
      >
        <p className="text-sm text-text-muted">
          Cette action est définitive. Voulez-vous vraiment supprimer «{" "}
          {deletingCategory?.name} » ?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={deleteMutation.isPending}
            onClick={() => setDeletingCategory(null)}
          >
            Annuler
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            {deleteMutation.isPending ? "Suppression..." : "Confirmer"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
