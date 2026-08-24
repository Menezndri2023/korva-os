"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { updateOfferSchema, type UpdateOfferInput } from "@korva/validation";
import { OFFER_STATUSES, OFFER_TYPES, type Offer, type OfferType } from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { formatCurrency } from "@/lib/analytics-format";

const TYPE_LABELS: Record<OfferType, string> = {
  product: "Produit",
  service: "Service",
  booking: "Réservation",
  digital_product: "Produit numérique",
  subscription: "Abonnement",
  package: "Forfait",
};

const STATUS_VARIANT: Record<Offer["status"], "default" | "success" | "warning"> = {
  active: "success",
  archived: "default",
  draft: "warning",
};

export default function OfferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const authReady = useAuthReady();
  const [isEditing, setIsEditing] = useState(false);

  const offerQuery = useQuery({
    queryKey: ["offers", id],
    queryFn: () => apiClient.get<Offer>(`/offers/${id}`),
    enabled: authReady,
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UpdateOfferInput>({ resolver: zodResolver(updateOfferSchema) });

  function startEdit(offer: Offer) {
    setIsEditing(true);
    reset({
      type: offer.type,
      sku: offer.sku,
      name: offer.name,
      description: offer.description,
      pricing: offer.pricing,
      status: offer.status,
    });
  }
  function cancelEdit() {
    setIsEditing(false);
    reset();
  }

  const updateMutation = useMutation({
    mutationFn: (input: UpdateOfferInput) => apiClient.patch<Offer>(`/offers/${id}`, input),
    onSuccess: () => {
      setIsEditing(false);
      return queryClient.invalidateQueries({ queryKey: ["offers"] });
    },
  });

  if (offerQuery.isLoading) {
    return <p className="text-sm text-text-muted">Chargement...</p>;
  }

  if (offerQuery.isError || !offerQuery.data) {
    const error = offerQuery.error;
    const message =
      error instanceof ApiError ? error.message : "Impossible de charger cette offre.";
    return (
      <Card className="p-6">
        <p className="text-sm text-destructive">{message}</p>
        <Link
          href="/dashboard/catalog"
          className="mt-2 inline-block text-sm font-medium text-text underline"
        >
          Retour au catalogue
        </Link>
      </Card>
    );
  }

  const offer = offerQuery.data;

  return (
    <div className="space-y-4">
      <Link href="/dashboard/catalog" className="text-sm text-text-muted hover:underline">
        ← Catalogue
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{offer.name}</h1>
            <p className="text-sm text-text-muted">{TYPE_LABELS[offer.type]}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={STATUS_VARIANT[offer.status]}>{offer.status}</Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => (isEditing ? cancelEdit() : startEdit(offer))}
            >
              {isEditing ? "Annuler" : "Modifier"}
            </Button>
          </div>
        </div>

        {!isEditing ? (
          <>
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <dt className="text-text-muted">SKU</dt>
                <dd className="mt-0.5">{offer.sku ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Prix</dt>
                <dd className="mt-0.5">
                  {formatCurrency(offer.pricing.amount, offer.pricing.currency)}
                </dd>
              </div>
              {offer.pricing.taxRate != null && (
                <div>
                  <dt className="text-text-muted">TVA</dt>
                  <dd className="mt-0.5">{offer.pricing.taxRate}%</dd>
                </div>
              )}
            </dl>

            {offer.description && (
              <div className="mt-4">
                <dt className="text-sm text-text-muted">Description</dt>
                <dd className="mt-0.5 text-sm text-text">{offer.description}</dd>
              </div>
            )}

            {offer.categories.length > 0 && (
              <div className="mt-4">
                <dt className="text-sm text-text-muted">Catégories</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {offer.categories.map((category) => (
                    <Badge key={category}>{category}</Badge>
                  ))}
                </dd>
              </div>
            )}
          </>
        ) : (
          <form
            onSubmit={handleSubmit((values) => updateMutation.mutate(values))}
            className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <select
              className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
              {...register("type")}
            >
              {OFFER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </select>
            <select
              className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
              {...register("status")}
            >
              {OFFER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
            <Input placeholder="SKU" {...register("sku")} />
            <Input placeholder="Nom" className="col-span-2" {...register("name")} />
            {errors.name && (
              <p className="col-span-2 text-xs text-destructive">{errors.name.message}</p>
            )}
            <textarea
              placeholder="Description"
              className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
              rows={2}
              {...register("description")}
            />
            <Input
              type="number"
              step="0.01"
              placeholder="Prix"
              {...register("pricing.amount", { valueAsNumber: true })}
            />
            <Input placeholder="Devise (EUR)" {...register("pricing.currency")} />
            {errors.pricing?.currency && (
              <p className="col-span-2 text-xs text-destructive">
                {errors.pricing.currency.message}
              </p>
            )}

            {updateMutation.isError && (
              <p className="col-span-2 text-sm text-destructive">
                {updateMutation.error instanceof ApiError
                  ? updateMutation.error.message
                  : "Impossible d'enregistrer l'offre."}
              </p>
            )}

            <div className="col-span-2 flex gap-2">
              <Button type="submit" loading={updateMutation.isPending}>
                {updateMutation.isPending ? "Enregistrement..." : "Enregistrer"}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelEdit}>
                Annuler
              </Button>
            </div>
          </form>
        )}
      </Card>

      {offer.variants.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
              <tr>
                <th className="px-4 py-2">Variante</th>
                <th className="px-4 py-2">SKU</th>
                <th className="px-4 py-2">Prix</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {offer.variants.map((variant) => (
                <tr key={variant.id}>
                  <td className="px-4 py-2 font-medium">{variant.name}</td>
                  <td className="px-4 py-2 text-text-muted">{variant.sku ?? "—"}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {variant.priceOverride != null
                      ? formatCurrency(variant.priceOverride, offer.pricing.currency)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
