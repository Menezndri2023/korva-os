"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOfferSchema, type CreateOfferInput } from "@korva/validation";
import { OFFER_TYPES, type Offer, type OfferType } from "@korva/types";
import { apiClient, ApiError } from "@/lib/api-client";

const TYPE_LABELS: Record<OfferType, string> = {
  product: "Produit",
  service: "Service",
  booking: "Réservation",
  digital_product: "Produit numérique",
  subscription: "Abonnement",
  package: "Forfait",
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
        <p className="mt-1 text-sm text-zinc-500">Produits, services et autres offres.</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="">Tous les types</option>
          {OFFER_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          {showForm ? "Annuler" : "Nouvelle offre"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) => createMutation.mutate(values))}
          className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-200 bg-white p-4"
        >
          <select className="rounded-md border border-zinc-300 px-3 py-2 text-sm" {...register("type")}>
            {OFFER_TYPES.map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <input
            placeholder="SKU"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("sku")}
          />
          <input
            placeholder="Nom"
            className="col-span-2 rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("name")}
          />
          {errors.name && <p className="col-span-2 text-xs text-red-600">{errors.name.message}</p>}
          <textarea
            placeholder="Description"
            className="col-span-2 rounded-md border border-zinc-300 px-3 py-2 text-sm"
            rows={2}
            {...register("description")}
          />
          <input
            type="number"
            step="0.01"
            placeholder="Prix"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("pricing.amount", { valueAsNumber: true })}
          />
          <input
            placeholder="Devise (EUR)"
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            {...register("pricing.currency")}
          />
          {errors.pricing?.currency && (
            <p className="col-span-2 text-xs text-red-600">{errors.pricing.currency.message}</p>
          )}

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
            {createMutation.isPending ? "Création..." : "Créer l'offre"}
          </button>
        </form>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-2">Nom</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Prix</th>
              <th className="px-4 py-2">Statut</th>
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
                  Aucune offre.
                </td>
              </tr>
            )}
            {data?.map((offer) => (
              <tr key={offer.id}>
                <td className="px-4 py-2 font-medium">{offer.name}</td>
                <td className="px-4 py-2 text-zinc-600">{TYPE_LABELS[offer.type]}</td>
                <td className="px-4 py-2 text-zinc-600">
                  {offer.pricing.amount} {offer.pricing.currency}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      offer.status === "active"
                        ? "bg-green-100 text-green-700"
                        : offer.status === "archived"
                          ? "bg-zinc-100 text-zinc-500"
                          : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {offer.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
