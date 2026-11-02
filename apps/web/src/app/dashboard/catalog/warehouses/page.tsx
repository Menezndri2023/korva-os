"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  type CreateWarehouseInput,
  type UpdateWarehouseInput,
} from "@korva/validation";
import type { Warehouse } from "@korva/types";
import { Badge, Button, Card, Dialog, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useT, type Translate } from "@/lib/dashboard-locale";
import { PlanLock } from "@/components/plan-lock";
import { usePlanFeatures } from "@/lib/use-plan-features";

function deleteErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    if (error.code === "WAREHOUSE_IN_USE") {
      return t(
        "Cet entrepôt contient encore du stock et ne peut pas être supprimé.",
        "This warehouse still holds stock and cannot be deleted.",
      );
    }
    return error.message;
  }
  return t("Impossible de supprimer l'entrepôt.", "The warehouse could not be deleted.");
}

export default function WarehousesPage() {
  const t = useT();
  const planFeatures = usePlanFeatures();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(null);
  const [deletingWarehouse, setDeletingWarehouse] = useState<Warehouse | null>(null);

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => apiClient.get<Warehouse[]>("/warehouses"),
    enabled: authReady,
  });

  const createForm = useForm<CreateWarehouseInput>({
    resolver: zodResolver(createWarehouseSchema),
    defaultValues: { name: "" },
  });
  const createMutation = useMutation({
    mutationFn: (input: CreateWarehouseInput) => apiClient.post<Warehouse>("/warehouses", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      createForm.reset({ name: "" });
      setIsCreateOpen(false);
    },
  });
  function closeCreateDialog() {
    setIsCreateOpen(false);
    createForm.reset({ name: "" });
  }

  const editForm = useForm<UpdateWarehouseInput>({ resolver: zodResolver(updateWarehouseSchema) });
  function startEdit(warehouse: Warehouse) {
    setEditingWarehouse(warehouse);
    editForm.reset({
      name: warehouse.name,
      address: warehouse.address,
      isDefault: warehouse.isDefault,
    });
  }
  function closeEditDialog() {
    setEditingWarehouse(null);
    editForm.reset();
  }
  const updateMutation = useMutation({
    mutationFn: (input: UpdateWarehouseInput) => {
      if (!editingWarehouse) throw new Error("No warehouse selected for editing");
      return apiClient.patch<Warehouse>(`/warehouses/${editingWarehouse.id}`, input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      closeEditDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!deletingWarehouse) throw new Error("No warehouse selected for deletion");
      return apiClient.delete<{ deleted: true }>(`/warehouses/${deletingWarehouse.id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      setDeletingWarehouse(null);
    },
    onError: () => setDeletingWarehouse(null),
  });

  const warehouses = warehousesQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-muted">
          {t(
            "Le stock d'une offre peut être réparti entre plusieurs entrepôts — voir la fiche de chaque produit.",
            "An offer's stock can be split between several warehouses — see each product's page.",
          )}
        </p>
        {/* Creating needs the plan; what already exists stays listed and usable. */}
        {planFeatures.has("warehouses") ? (
          <Button onClick={() => setIsCreateOpen(true)}>{t("Nouvel entrepôt", "New warehouse")}</Button>
        ) : (
          <PlanLock feature="warehouses" />
        )}
      </div>

      {deleteMutation.isError && (
        <p className="text-sm text-destructive">{deleteErrorMessage(deleteMutation.error, t)}</p>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">{t("Nom", "Name")}</th>
                <th className="px-4 py-2">{t("Adresse", "Address")}</th>
                <th className="px-4 py-2">{t("Par défaut", "Default")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {warehousesQuery.isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    {t("Chargement...", "Loading...")}
                  </td>
                </tr>
              )}
              {!warehousesQuery.isLoading && warehouses?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    {t("Aucun entrepôt.", "No warehouses.")}
                  </td>
                </tr>
              )}
              {warehouses?.map((warehouse) => (
                <tr key={warehouse.id}>
                  <td className="px-4 py-2 font-medium">{warehouse.name}</td>
                  <td className="px-4 py-2 text-text-muted">{warehouse.address ?? "—"}</td>
                  <td className="px-4 py-2">{warehouse.isDefault && <Badge>{t("Par défaut", "Default")}</Badge>}</td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => startEdit(warehouse)}>
                        {t("Modifier", "Edit")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeletingWarehouse(warehouse)}
                      >
                        {t("Supprimer", "Delete")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={isCreateOpen} onClose={closeCreateDialog} title={t("Nouvel entrepôt", "New warehouse")}>
        <form
          onSubmit={createForm.handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3"
        >
          <Input placeholder={t("Nom", "Name")} {...createForm.register("name")} />
          {createForm.formState.errors.name && (
            <p className="text-xs text-destructive">{createForm.formState.errors.name.message}</p>
          )}
          <Input
            placeholder={t("Adresse", "Address")}
            {...createForm.register("address", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof ApiError
                ? createMutation.error.message
                : t("Impossible de créer l'entrepôt.", "The warehouse could not be created.")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeCreateDialog}>
              {t("Annuler", "Cancel")}
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              {createMutation.isPending ? t("Création...", "Creating...") : t("Créer", "Create")}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={editingWarehouse !== null}
        onClose={closeEditDialog}
        title={t("Modifier l'entrepôt", "Edit the warehouse")}
      >
        <form
          onSubmit={editForm.handleSubmit((values) => updateMutation.mutate(values))}
          className="space-y-3"
        >
          <Input placeholder={t("Nom", "Name")} {...editForm.register("name")} />
          <Input
            placeholder={t("Adresse", "Address")}
            {...editForm.register("address", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          />
          <label className="flex items-center gap-2 text-sm text-text-muted">
            <input type="checkbox" {...editForm.register("isDefault")} />
            {t("Entrepôt par défaut", "Default warehouse")}
          </label>
          {updateMutation.isError && (
            <p className="text-sm text-destructive">
              {updateMutation.error instanceof ApiError
                ? updateMutation.error.message
                : t("Impossible d'enregistrer l'entrepôt.", "The warehouse could not be saved.")}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeEditDialog}>
              {t("Annuler", "Cancel")}
            </Button>
            <Button type="submit" loading={updateMutation.isPending}>
              {updateMutation.isPending ? t("Enregistrement...", "Saving...") : t("Enregistrer", "Save")}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deletingWarehouse !== null}
        onClose={() => setDeletingWarehouse(null)}
        title={t("Supprimer l'entrepôt ?", "Delete the warehouse?")}
      >
        <p className="text-sm text-text-muted">
          {t(
            `Cette action est définitive. Voulez-vous vraiment supprimer « ${deletingWarehouse?.name} » ?`,
            `This cannot be undone. Do you really want to delete “${deletingWarehouse?.name}”?`,
          )}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={deleteMutation.isPending}
            onClick={() => setDeletingWarehouse(null)}
          >
            {t("Annuler", "Cancel")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            loading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            {deleteMutation.isPending ? t("Suppression...", "Deleting...") : t("Confirmer", "Confirm")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
