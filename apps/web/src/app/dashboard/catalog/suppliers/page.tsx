"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createSupplierSchema,
  updateSupplierSchema,
  type CreateSupplierInput,
  type UpdateSupplierInput,
} from "@korva/validation";
import type { Supplier } from "@korva/types";
import { Button, Card, Dialog, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { PlanLock } from "@/components/plan-lock";
import { usePlanFeatures } from "@/lib/use-plan-features";

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "SUPPLIER_IN_USE") {
      return "Ce fournisseur a encore une commande fournisseur active et ne peut pas être supprimé.";
    }
    return error.message;
  }
  return "Impossible de supprimer le fournisseur.";
}

export default function SuppliersPage() {
  const planFeatures = usePlanFeatures();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const [search, setSearch] = useState("");

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [deletingSupplier, setDeletingSupplier] = useState<Supplier | null>(null);

  const suppliersQuery = useQuery({
    queryKey: ["suppliers", search],
    queryFn: () =>
      apiClient.get<Supplier[]>(
        `/suppliers${search ? `?search=${encodeURIComponent(search)}` : ""}`,
      ),
    enabled: authReady,
  });

  const createForm = useForm<CreateSupplierInput>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: { name: "" },
  });
  const createMutation = useMutation({
    mutationFn: (input: CreateSupplierInput) => apiClient.post<Supplier>("/suppliers", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      createForm.reset({ name: "" });
      setIsCreateOpen(false);
    },
  });
  function closeCreateDialog() {
    setIsCreateOpen(false);
    createForm.reset({ name: "" });
  }

  const editForm = useForm<UpdateSupplierInput>({ resolver: zodResolver(updateSupplierSchema) });
  function startEdit(supplier: Supplier) {
    setEditingSupplier(supplier);
    editForm.reset({
      name: supplier.name,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      notes: supplier.notes,
    });
  }
  function closeEditDialog() {
    setEditingSupplier(null);
    editForm.reset();
  }
  const updateMutation = useMutation({
    mutationFn: (input: UpdateSupplierInput) => {
      if (!editingSupplier) throw new Error("No supplier selected for editing");
      return apiClient.patch<Supplier>(`/suppliers/${editingSupplier.id}`, input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      closeEditDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!deletingSupplier) throw new Error("No supplier selected for deletion");
      return apiClient.delete<{ deleted: true }>(`/suppliers/${deletingSupplier.id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      setDeletingSupplier(null);
    },
    onError: () => setDeletingSupplier(null),
  });

  const suppliers = suppliersQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          placeholder="Rechercher un fournisseur..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64"
        />
        {/* Creating needs the plan; what already exists stays listed and usable. */}
        {planFeatures.has("suppliers") ? (
          <Button onClick={() => setIsCreateOpen(true)}>Nouveau fournisseur</Button>
        ) : (
          <PlanLock feature="suppliers" />
        )}
      </div>

      {deleteMutation.isError && (
        <p className="text-sm text-destructive">{deleteErrorMessage(deleteMutation.error)}</p>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">Nom</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Téléphone</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {suppliersQuery.isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    Chargement...
                  </td>
                </tr>
              )}
              {!suppliersQuery.isLoading && suppliers?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    Aucun fournisseur.
                  </td>
                </tr>
              )}
              {suppliers?.map((supplier) => (
                <tr key={supplier.id}>
                  <td className="px-4 py-2 font-medium">{supplier.name}</td>
                  <td className="px-4 py-2 text-text-muted">{supplier.email ?? "—"}</td>
                  <td className="px-4 py-2 text-text-muted">{supplier.phone ?? "—"}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => startEdit(supplier)}>
                        Modifier
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingSupplier(supplier)}
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

      <Dialog open={isCreateOpen} onClose={closeCreateDialog} title="Nouveau fournisseur">
        <form
          onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3"
        >
          <Input placeholder="Nom" {...createForm.register("name")} />
          {createForm.formState.errors.name && (
            <p className="text-xs text-destructive">{createForm.formState.errors.name.message}</p>
          )}
          <Input
            placeholder="Email"
            type="email"
            {...createForm.register("email", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          <Input
            placeholder="Téléphone"
            {...createForm.register("phone", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          <Input
            placeholder="Adresse"
            {...createForm.register("address", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          <textarea
            placeholder="Notes"
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={2}
            {...createForm.register("notes", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof ApiError
                ? createMutation.error.message
                : "Impossible de créer le fournisseur."}
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
        open={editingSupplier !== null}
        onClose={closeEditDialog}
        title="Modifier le fournisseur"
      >
        <form
          onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}
          className="space-y-3"
        >
          <Input placeholder="Nom" {...editForm.register("name")} />
          <Input
            placeholder="Email"
            type="email"
            {...editForm.register("email", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          <Input
            placeholder="Téléphone"
            {...editForm.register("phone", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          <Input
            placeholder="Adresse"
            {...editForm.register("address", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          <textarea
            placeholder="Notes"
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={2}
            {...editForm.register("notes", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          {updateMutation.isError && (
            <p className="text-sm text-destructive">
              {updateMutation.error instanceof ApiError
                ? updateMutation.error.message
                : "Impossible d'enregistrer le fournisseur."}
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
        open={deletingSupplier !== null}
        onClose={() => setDeletingSupplier(null)}
        title="Supprimer le fournisseur ?"
      >
        <p className="text-sm text-text-muted">
          Cette action est définitive. Voulez-vous vraiment supprimer «{" "}
          {deletingSupplier?.name} » ?
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={deleteMutation.isPending}
            onClick={() => setDeletingSupplier(null)}
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
