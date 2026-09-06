"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createOfferSchema, type CreateOfferInput } from "@korva/validation";
import { OFFER_TYPES, type CustomFieldValues, type Offer, type OfferType } from "@korva/types";
import { Badge, Button, Card, Input, Pagination } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { CustomFieldsFieldset } from "@/components/custom-fields-fieldset";

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
  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const authReady = useAuthReady();

  const { data: offersPage, isLoading } = useQuery({
    queryKey: ["offers", typeFilter, page],
    queryFn: () =>
      apiClient.getList<Offer>(
        `/offers?page=${page}${typeFilter ? `&type=${typeFilter}` : ""}`,
      ),
    enabled: authReady,
  });
  const data = offersPage?.data;

  const {
    register,
    handleSubmit,
    reset,
    watch,
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
      trackStock: false,
    },
  });
  const trackStock = watch("trackStock");

  const [createCustomFields, setCreateCustomFields] = useState<CustomFieldValues>({});
  const createMutation = useMutation({
    mutationFn: (input: CreateOfferInput) => apiClient.post<Offer>("/offers", input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["offers"] });
      reset();
      setCreateCustomFields({});
      setShowForm(false);
    },
  });

  return (
    <div className="space-y-6">
      <p className="text-sm text-text-muted">Produits, services et autres offres.</p>

      <div className="flex items-center justify-between gap-3">
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
        >
          <option value="">Tous les types</option>
          {OFFER_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Annuler" : "Nouvelle offre"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) =>
            createMutation.mutate({ ...values, customFields: createCustomFields }),
          )}
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
          <Input placeholder="Code-barres (EAN/UPC)" {...register("barcode")} />
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
          <label className="col-span-2 flex items-center gap-2 text-sm text-text-muted">
            <input type="checkbox" {...register("trackStock")} />
            Suivre le stock pour cette offre
          </label>
          {trackStock && (
            <Input
              type="number"
              step="1"
              placeholder="Stock initial"
              className="col-span-2"
              {...register("stockOnHand", {
                setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
              })}
            />
          )}

          <CustomFieldsFieldset
            entity="offers"
            values={createCustomFields}
            onChange={setCreateCustomFields}
            idPrefix="offer-create"
          />

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
        <div className="overflow-x-auto">
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
                  <td className="px-4 py-2 font-medium">
                    <Link
                      href={`/dashboard/catalog/${offer.id}`}
                      className="text-text underline-offset-2 hover:underline"
                    >
                      {offer.name}
                    </Link>
                  </td>
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
        </div>
      </Card>

      <Pagination
        page={page}
        totalPages={offersPage?.pagination.totalPages ?? 1}
        onPageChange={setPage}
        disabled={isLoading}
      />
    </div>
  );
}
