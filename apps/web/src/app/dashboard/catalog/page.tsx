"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOfferSchema, type CreateOfferInput } from "@korva/validation";
import { OFFER_TYPES, type Offer, type OfferType } from "@korva/types";
import { Badge, Button, Card, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";

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

export default function CatalogPage() {
  const [typeFilter, setTypeFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["offers", typeFilter],
    queryFn: () => apiClient.get<Offer[]>(`/offers${typeFilter ? `?type=${typeFilter}` : ""}`),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateOfferInput>({
    resolver: zodResolver(createOfferSchema),
    defaultValues: {
      type: "product",
      images: [],
      categories: [],
      variants: [],
      status: "draft",
      pricing: { amount: 0, currency: "EUR" },
    },
  });

  const createMutation = useMutation({
    mutationFn: (input: CreateOfferInput) => apiClient.post<Offer>("/offers", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["offers"] });
      reset();
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Catalogue</h1>
        <p className="mt-1 text-sm text-text-muted">Produits, services et autres offres.</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
        >
          <option value="">Tous les types</option>
          {OFFER_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Annuler" : "Nouvelle offre"}</Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion already documented on the
          // other migrated create-forms (dashboard/crm, dashboard/bookings).
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
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
          <Input placeholder="SKU" {...register("sku")} />
          <Input placeholder="Nom" className="col-span-2" {...register("name")} />
          {errors.name && <p className="col-span-2 text-xs text-destructive">{errors.name.message}</p>}
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
            <p className="col-span-2 text-xs text-destructive">{errors.pricing.currency.message}</p>
          )}

          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {createMutation.error instanceof ApiError ? createMutation.error.message : "Erreur"}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? "Création..." : "Créer l'offre"}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
            <tr>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Prix</th>
              <th className="px-4 py-2">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                  Chargement...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                  Aucune offre.
                </td>
              </tr>
            )}
            {data?.map((offer) => (
              <tr key={offer.id}>
                <td className="px-4 py-2 font-medium">{offer.name}</td>
                <td className="px-4 py-2 text-text-muted">{TYPE_LABELS[offer.type]}</td>
                <td className="px-4 py-2 text-text-muted">
                  {offer.pricing.amount} {offer.pricing.currency}
                </td>
                <td className="px-4 py-2">
                  <Badge variant={STATUS_VARIANT[offer.status]}>{offer.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
