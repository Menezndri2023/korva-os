"use client";

import { useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPurchaseOrderSchema,
  type CreatePurchaseOrderInput,
} from "@korva/validation";
import { PURCHASE_ORDER_STATUSES } from "@korva/types";
import type { Offer, PurchaseOrder, PurchaseOrderStatus, Supplier, Warehouse } from "@korva/types";
import { Badge, Button, Card, Dialog, Input, Pagination, Select } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { formatCurrency } from "@/lib/analytics-format";
import { PlanLock } from "@/components/plan-lock";
import { usePlanFeatures } from "@/lib/use-plan-features";

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: "Brouillon",
  ordered: "Commandée",
  received: "Réceptionnée",
  cancelled: "Annulée",
};

function poTotal(po: PurchaseOrder): number {
  return po.items.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Une erreur est survenue.";
}

export default function PurchaseOrdersPage() {
  const planFeatures = usePlanFeatures();
  const [statusFilter, setStatusFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const { data: poPage, isLoading } = useQuery({
    queryKey: ["purchase-orders", statusFilter, page],
    queryFn: () =>
      apiClient.getList<PurchaseOrder>(
        `/purchase-orders?page=${page}${statusFilter ? `&status=${statusFilter}` : ""}`,
      ),
    enabled: authReady,
  });
  const purchaseOrders = poPage?.data;

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers", ""],
    queryFn: () => apiClient.get<Supplier[]>("/suppliers"),
    enabled: authReady,
  });
  const { data: offers } = useQuery({
    queryKey: ["offers", "tracked"],
    queryFn: () => apiClient.get<Offer[]>("/offers"),
    enabled: authReady,
  });
  function supplierName(supplierId: string): string {
    return suppliers?.find((s) => s.id === supplierId)?.name ?? "—";
  }

  const { register, control, handleSubmit, reset, formState } =
    useForm<CreatePurchaseOrderInput>({
      resolver: zodResolver(createPurchaseOrderSchema),
      defaultValues: { items: [{ offerId: "", quantity: 1, unitCost: 0 }] },
    });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });

  const createMutation = useMutation({
    mutationFn: (input: CreatePurchaseOrderInput) =>
      apiClient.post<PurchaseOrder>("/purchase-orders", input),
    onSuccess: () => {
      invalidate();
      reset({ items: [{ offerId: "", quantity: 1, unitCost: 0 }] });
      setShowForm(false);
    },
  });

  const [actionErrorFor, setActionErrorFor] = useState<{ id: string; message: string } | null>(
    null,
  );
  function runAction(mutationFn: (id: string) => Promise<unknown>) {
    return async (id: string) => {
      setActionErrorFor(null);
      try {
        await mutationFn(id);
        invalidate();
      } catch (error) {
        setActionErrorFor({ id, message: actionErrorMessage(error) });
      }
    };
  }
  const markOrdered = runAction((id) => apiClient.post(`/purchase-orders/${id}/mark-ordered`));
  const cancel = runAction((id) => apiClient.post(`/purchase-orders/${id}/cancel`));

  // Receiving is keyed by offerId alone (not offerId+variantId) — safe because the create form
  // above never lets staff pick a variant, so no PO built through this UI can have two lines
  // sharing one offerId. A PO created directly via the API with variant-level lines would need
  // the dialog extended before this UI could receive it correctly.
  const [receivingPo, setReceivingPo] = useState<PurchaseOrder | null>(null);
  const [receiveQuantities, setReceiveQuantities] = useState<Record<string, number>>({});
  const [receiveWarehouseId, setReceiveWarehouseId] = useState("");
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: () => apiClient.get<Warehouse[]>("/warehouses"),
    enabled: authReady,
  });
  const receiveMutation = useMutation({
    mutationFn: ({
      id,
      items,
      warehouseId,
    }: {
      id: string;
      items: { offerId: string; quantity: number }[];
      warehouseId?: string;
    }) => apiClient.post(`/purchase-orders/${id}/receive`, { items, warehouseId }),
    onSuccess: () => {
      invalidate();
      setReceivingPo(null);
    },
    onError: (error: unknown) => setReceiveError(actionErrorMessage(error)),
  });

  function openReceiveDialog(po: PurchaseOrder) {
    setReceiveError(null);
    setReceiveWarehouseId("");
    setReceiveQuantities(
      Object.fromEntries(
        po.items.map((item) => [item.offerId, item.quantity - item.receivedQuantity]),
      ),
    );
    setReceivingPo(po);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
        >
          <option value="">Tous les statuts</option>
          {PURCHASE_ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        {/* Creating needs the plan; what already exists stays listed and usable. */}
        {planFeatures.has("suppliers") ? (
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Annuler" : "Nouvelle commande fournisseur"}
          </Button>
        ) : (
          <PlanLock feature="suppliers" />
        )}
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="space-y-3 rounded-lg border border-border bg-surface p-4"
        >
          <select
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            defaultValue=""
            {...register("supplierId")}
          >
            <option value="" disabled>
              Choisir un fournisseur
            </option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {formState.errors.supplierId && (
            <p className="text-xs text-destructive">{formState.errors.supplierId.message}</p>
          )}

          <div className="space-y-2">
            {fields.map((field, index) => (
              <div key={field.id} className="grid grid-cols-12 gap-2">
                <select
                  className="col-span-6 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
                  defaultValue=""
                  {...register(`items.${index}.offerId`)}
                >
                  <option value="" disabled>
                    Choisir un article
                  </option>
                  {offers?.map((offer) => (
                    <option key={offer.id} value={offer.id}>
                      {offer.name}
                      {!offer.trackStock ? " (stock non suivi)" : ""}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  placeholder="Qté"
                  className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
                  {...register(`items.${index}.quantity`, { valueAsNumber: true })}
                />
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  placeholder="Coût unitaire"
                  className="col-span-3 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
                  {...register(`items.${index}.unitCost`, { valueAsNumber: true })}
                />
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="col-span-1 text-sm text-destructive hover:underline"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => append({ offerId: "", quantity: 1, unitCost: 0 })}
              className="text-sm text-text-muted hover:underline"
            >
              + Ajouter une ligne
            </button>
          </div>

          <textarea
            placeholder="Notes (optionnel)"
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={2}
            {...register("notes", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
          />

          {createMutation.isError && (
            <p className="text-sm text-destructive">
              {createMutation.error instanceof ApiError
                ? createMutation.error.message
                : "Erreur"}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending}>
            {createMutation.isPending ? "Création..." : "Créer la commande"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">Fournisseur</th>
                <th className="px-4 py-2">Articles</th>
                <th className="px-4 py-2">Total</th>
                <th className="px-4 py-2">Statut</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    Chargement...
                  </td>
                </tr>
              )}
              {!isLoading && purchaseOrders?.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-text-muted">
                    Aucune commande fournisseur.
                  </td>
                </tr>
              )}
              {purchaseOrders?.map((po) => (
                <tr key={po.id}>
                  <td className="px-4 py-2 font-medium">{supplierName(po.supplierId)}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {po.items
                      .map((item) =>
                        po.status === "ordered" && item.receivedQuantity > 0
                          ? `${item.name} (${item.receivedQuantity}/${item.quantity} reçus)`
                          : item.name,
                      )
                      .join(", ")}
                  </td>
                  <td className="px-4 py-2 text-text-muted">
                    {formatCurrency(poTotal(po), po.currency)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge>{STATUS_LABELS[po.status]}</Badge>
                  </td>
                  <td className="px-4 py-2 space-x-2">
                    {po.status === "draft" && (
                      <button
                        onClick={() => markOrdered(po.id)}
                        className="text-xs text-text-muted hover:underline"
                      >
                        Marquer commandée
                      </button>
                    )}
                    {po.status === "ordered" && (
                      <button
                        onClick={() => openReceiveDialog(po)}
                        className="text-xs text-text-muted hover:underline"
                      >
                        Réceptionner
                      </button>
                    )}
                    {(po.status === "draft" || po.status === "ordered") && (
                      <button
                        onClick={() => cancel(po.id)}
                        className="text-xs text-destructive hover:underline"
                      >
                        Annuler
                      </button>
                    )}
                    {actionErrorFor?.id === po.id && (
                      <p className="mt-1 text-xs text-destructive">{actionErrorFor.message}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Pagination
        page={page}
        totalPages={poPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />

      <Dialog
        open={receivingPo !== null}
        onClose={() => setReceivingPo(null)}
        title="Réceptionner la commande"
      >
        {receivingPo && (
          <div className="space-y-3">
            <p className="text-sm text-text-muted">
              Indiquez la quantité effectivement reçue pour chaque article — une livraison
              partielle laisse la commande au statut « Commandée » jusqu&apos;à réception
              complète.
            </p>
            {receivingPo.items.map((item) => {
              const remaining = item.quantity - item.receivedQuantity;
              if (remaining <= 0) return null;
              return (
                <div key={item.offerId} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-text">
                    {item.name}
                    <span className="text-text-muted"> — {remaining} restant(s)</span>
                  </span>
                  <Input
                    type="number"
                    min={0}
                    max={remaining}
                    className="w-24"
                    value={receiveQuantities[item.offerId] ?? 0}
                    onChange={(e) =>
                      setReceiveQuantities((prev) => ({
                        ...prev,
                        [item.offerId]: Number(e.target.value),
                      }))
                    }
                  />
                </div>
              );
            })}
            {warehousesQuery.data && warehousesQuery.data.length > 0 && (
              <label className="flex items-center gap-2 text-sm text-text-muted">
                Entrepôt de réception
                <Select
                  value={receiveWarehouseId}
                  onChange={(e) => setReceiveWarehouseId(e.target.value)}
                  className="w-56"
                >
                  <option value="">Aucun entrepôt (global)</option>
                  {warehousesQuery.data.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </Select>
              </label>
            )}
            {receiveError && <p className="text-sm text-destructive">{receiveError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReceivingPo(null)}>
                Annuler
              </Button>
              <Button
                loading={receiveMutation.isPending}
                onClick={() => {
                  setReceiveError(null);
                  const items = Object.entries(receiveQuantities)
                    .filter(([, quantity]) => quantity > 0)
                    .map(([offerId, quantity]) => ({ offerId, quantity }));
                  if (items.length === 0) {
                    setReceiveError("Indiquez au moins une quantité à réceptionner.");
                    return;
                  }
                  receiveMutation.mutate({
                    id: receivingPo.id,
                    items,
                    warehouseId: receiveWarehouseId || undefined,
                  });
                }}
              >
                {receiveMutation.isPending ? "Réception..." : "Confirmer la réception"}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
