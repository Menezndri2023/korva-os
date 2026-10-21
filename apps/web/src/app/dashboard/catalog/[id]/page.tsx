"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  OFFER_MAX_DURATION_MINUTES,
  OFFER_MIN_DURATION_MINUTES,
  recordStockMovementSchema,
  updateOfferSchema,
  type RecordStockMovementInput,
  type UpdateOfferInput,
} from "@korva/validation";
import {
  BUSINESS_MODEL_DEFINITIONS,
  BUSINESS_MODEL_OFFER_FIELDS,
  OFFER_STATUSES,
  OFFER_TYPES,
  STOCK_MOVEMENT_TYPES,
  type CustomFieldValues,
  type Offer,
  type OfferOptionGroup,
  type OfferType,
  type StockLevel,
  type StockMovement,
  type StockMovementType,
  type Warehouse,
} from "@korva/types";
import { Badge, Button, Card, Dialog, Input, Pagination, Select } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { formatCurrency } from "@/lib/analytics-format";
import { CustomFieldsDisplay } from "@/components/custom-fields-display";
import { CustomFieldsFieldset } from "@/components/custom-fields-fieldset";
import { OfferImagesEditor } from "@/components/offer-images-editor";
import { PlanLock } from "@/components/plan-lock";
import { usePlanFeatures } from "@/lib/use-plan-features";
import { useActiveOrganization } from "@/lib/use-active-organization";
import {
  AttributesEditor,
  BundleItemsEditor,
  GuidedFieldsEditor,
  OFFER_TYPE_FIELDS,
  OptionGroupsEditor,
  VariantsEditor,
  type BundleItemDraft,
  type VariantDraft,
} from "@/components/offer-editors";
import { pruneForType } from "@/lib/offer-form-payload";

const STOCK_MOVEMENT_LABELS: Record<StockMovementType, string> = {
  received: "Réception",
  sold: "Vente",
  returned: "Retour",
  damaged: "Casse/perte",
  correction: "Correction",
};

/** "sold" is always automatic (order reservation) — never an option in the manual entry form. */
const MANUAL_STOCK_MOVEMENT_TYPES = STOCK_MOVEMENT_TYPES.filter(
  (type) => type !== "sold",
);

const TYPE_LABELS: Record<OfferType, string> = {
  product: "Produit",
  service: "Service",
  booking: "Réservation",
  digital_product: "Produit numérique",
  subscription: "Abonnement",
  package: "Forfait",
};

/** Shown to owners instead of the API's status keys. "En ligne" is the one that matters: only
 *  those offers appear on the public site. */
const STATUS_LABELS: Record<Offer["status"], string> = {
  draft: "Brouillon",
  active: "En ligne",
  archived: "Archivée",
};

const STATUS_VARIANT: Record<Offer["status"], "default" | "success" | "warning"> = {
  active: "success",
  archived: "default",
  draft: "warning",
};

function deleteErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "OFFER_IN_USE") {
      return "Cette offre ne peut pas être supprimée car elle est encore utilisée par d'autres données.";
    }
    return error.message;
  }
  return "Impossible de supprimer l'offre.";
}

export default function OfferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
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
    watch,
    setValue,
    formState: { errors },
  } = useForm<UpdateOfferInput>({ resolver: zodResolver(updateOfferSchema) });
  const trackStock = watch("trackStock");
  const images = watch("images") ?? [];
  const offerType = watch("type");
  const bookingUnit = watch("bookingUnit") ?? "slot";
  const fields = OFFER_TYPE_FIELDS[offerType ?? "product"];
  const { has } = usePlanFeatures();
  const { data: activeOrganization } = useActiveOrganization();
  // A promotion already on the offer stays editable after a downgrade; adding one needs the plan.
  const compareAtLocked =
    !has("compare_at_price") && offerQuery.data?.compareAtPrice == null;
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>([]);
  const [attributeDrafts, setAttributeDrafts] = useState<Record<string, string>>({});

  // Guided characteristics of the type of activity (a room's amenities, a property's surface),
  // for its main offer type only; the free editor then shows everything else.
  const businessModelKey = activeOrganization?.businessModel;
  const guidedFields =
    businessModelKey &&
    BUSINESS_MODEL_DEFINITIONS[businessModelKey].offerTypes[0] === offerType
      ? (BUSINESS_MODEL_OFFER_FIELDS[businessModelKey] ?? [])
      : [];
  const guidedKeys = new Set(guidedFields.map((field) => field.label));
  const freeAttributes = Object.fromEntries(
    Object.entries(attributeDrafts).filter(([key]) => !guidedKeys.has(key)),
  );
  function setGuidedAttribute(label: string, value: string | undefined) {
    setAttributeDrafts((current) => {
      const next = { ...current };
      if (value === undefined) delete next[label];
      else next[label] = value;
      return next;
    });
  }
  function setFreeAttributes(next: Record<string, string>) {
    setAttributeDrafts((current) => ({
      ...Object.fromEntries(Object.entries(current).filter(([key]) => guidedKeys.has(key))),
      ...next,
    }));
  }
  const [bundleDrafts, setBundleDrafts] = useState<BundleItemDraft[]>([]);
  const [optionGroupDrafts, setOptionGroupDrafts] = useState<OfferOptionGroup[]>([]);
  const [editCustomFields, setEditCustomFields] = useState<CustomFieldValues>({});

  function startEdit(offer: Offer) {
    setIsEditing(true);
    setEditCustomFields(offer.customFields ?? {});
    setVariantDrafts(
      offer.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        sku: variant.sku,
        barcode: variant.barcode,
        priceOverride: variant.priceOverride,
        stockOnHand: variant.stockOnHand,
      })),
    );
    setAttributeDrafts(offer.attributes ?? {});
    setBundleDrafts(
      (offer.bundleItems ?? []).map((item) => ({ offerId: item.offerId, quantity: item.quantity })),
    );
    setOptionGroupDrafts(offer.optionGroups ?? []);
    reset({
      type: offer.type,
      sku: offer.sku,
      barcode: offer.barcode,
      name: offer.name,
      description: offer.description,
      images: offer.images,
      pricing: offer.pricing,
      status: offer.status,
      trackStock: offer.trackStock,
      stockOnHand: offer.stockOnHand,
      lowStockThreshold: offer.lowStockThreshold,
      durationMinutes: offer.durationMinutes ?? null,
      compareAtPrice: offer.compareAtPrice ?? null,
      bookingUnit: offer.bookingUnit ?? "slot",
      minNights: offer.minNights ?? null,
      bufferMinutes: offer.bufferMinutes ?? null,
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

  const [stockInput, setStockInput] = useState("");
  const adjustStockMutation = useMutation({
    mutationFn: ({ stockOnHand, variantId }: { stockOnHand: number; variantId?: string }) =>
      apiClient.post<Offer>(`/offers/${id}/stock/adjust`, { stockOnHand, variantId }),
    onSuccess: () => {
      setStockInput("");
      return queryClient.invalidateQueries({ queryKey: ["offers", id] });
    },
  });

  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const deleteOfferMutation = useMutation({
    mutationFn: () => apiClient.delete<{ deleted: true }>(`/offers/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["offers"] });
      router.push("/dashboard/catalog");
    },
    onError: () => setDeleteConfirming(false),
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
            <Badge variant={STATUS_VARIANT[offer.status]}>{STATUS_LABELS[offer.status]}</Badge>
            {!isEditing && (
              // One click to put an offer on the site or take it off — the status otherwise sat
              // in the edit form only, as "draft"/"active", and new offers were drafts by default.
              <Button
                variant={offer.status === "active" ? "ghost" : "primary"}
                size="sm"
                loading={updateMutation.isPending}
                onClick={() =>
                  updateMutation.mutate({ status: offer.status === "active" ? "draft" : "active" })
                }
              >
                {offer.status === "active" ? "Retirer du site" : "Publier sur le site"}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              disabled={deleteConfirming}
              onClick={() => (isEditing ? cancelEdit() : startEdit(offer))}
            >
              {isEditing ? "Annuler" : "Modifier"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={isEditing}
              onClick={() => setDeleteConfirming(true)}
            >
              Supprimer
            </Button>
          </div>
        </div>

        {deleteOfferMutation.isError && (
          <p className="mt-3 text-sm text-destructive">
            {deleteErrorMessage(deleteOfferMutation.error)}
          </p>
        )}

        <Dialog
          open={deleteConfirming}
          onClose={() => setDeleteConfirming(false)}
          title="Supprimer l'offre ?"
        >
          <p className="text-sm text-text-muted">
            Cette action est définitive. Voulez-vous vraiment supprimer « {offer.name} » ?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={deleteOfferMutation.isPending}
              onClick={() => setDeleteConfirming(false)}
            >
              Annuler
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={deleteOfferMutation.isPending}
              onClick={() => deleteOfferMutation.mutate()}
            >
              {deleteOfferMutation.isPending ? "Suppression..." : "Confirmer ?"}
            </Button>
          </div>
        </Dialog>

        {!isEditing ? (
          <>
            {offer.images.length > 0 ? (
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Photos de l'offre">
                {offer.images.map((url, index) => (
                  <li key={url} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary/uploaded URL, not a static asset */}
                    <img
                      src={url}
                      alt={`Photo ${index + 1}`}
                      className="h-24 w-24 rounded-md border border-border object-cover"
                    />
                    {index === 0 && (
                      <span className="absolute left-1 top-1 rounded bg-surface px-1.5 py-0.5 text-[10px] font-medium text-text">
                        Principale
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-text-muted">
                Aucune photo — cliquez sur « Modifier » pour en ajouter.
              </p>
            )}
            <dl className="mt-4 grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <div>
                <dt className="text-text-muted">SKU</dt>
                <dd className="mt-0.5">{offer.sku ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Code-barres</dt>
                <dd className="mt-0.5">{offer.barcode ?? "—"}</dd>
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
              {offer.compareAtPrice != null && (
                <div>
                  <dt className="text-text-muted">Prix avant promotion</dt>
                  <dd className="mt-0.5 line-through">
                    {formatCurrency(offer.compareAtPrice, offer.pricing.currency)}
                  </dd>
                </div>
              )}
              {offer.attributes &&
                Object.entries(offer.attributes).map(([key, value]) => (
                  <div key={key}>
                    <dt className="text-text-muted">{key}</dt>
                    <dd className="mt-0.5">{value}</dd>
                  </div>
                ))}
              {offer.durationMinutes != null && (
                <div>
                  <dt className="text-text-muted">Durée</dt>
                  <dd className="mt-0.5">{offer.durationMinutes} min</dd>
                </div>
              )}
              {offer.variants.length === 0 && (
                <div>
                  <dt className="text-text-muted">Stock</dt>
                  <dd className="mt-0.5">
                    {offer.trackStock ? offer.stockOnHand ?? 0 : "Non suivi"}
                  </dd>
                </div>
              )}
              {offer.trackStock && offer.lowStockThreshold != null && (
                <div>
                  <dt className="text-text-muted">Seuil d&apos;alerte</dt>
                  <dd className="mt-0.5">{offer.lowStockThreshold}</dd>
                </div>
              )}
              <CustomFieldsDisplay entity="offers" values={offer.customFields} />
            </dl>

            {/* Offer-level adjust — only meaningful when there are no variants: with variants,
                stock lives entirely on each one (see the variants table below), never on the
                offer itself. */}
            {offer.trackStock && offer.variants.length === 0 && (
              <div className="mt-4 flex items-end gap-2">
                <Input
                  type="number"
                  step="1"
                  placeholder="Nouveau stock"
                  value={stockInput}
                  onChange={(e) => setStockInput(e.target.value)}
                  className="w-40"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  loading={adjustStockMutation.isPending}
                  disabled={stockInput === ""}
                  onClick={() =>
                    adjustStockMutation.mutate({ stockOnHand: Number(stockInput) })
                  }
                >
                  Ajuster le stock
                </Button>
                {offer.stockOnHand !== 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={adjustStockMutation.isPending}
                    onClick={() => adjustStockMutation.mutate({ stockOnHand: 0 })}
                  >
                    86 (marquer indisponible)
                  </Button>
                )}
              </div>
            )}

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
            onSubmit={handleSubmit((values) =>
              updateMutation.mutate({
                ...pruneForType(
                  values,
                  {
                    variants: variantDrafts,
                    attributes: attributeDrafts,
                    bundleItems: bundleDrafts,
                    optionGroups: optionGroupDrafts,
                  },
                  { clear: true },
                ),
                customFields: editCustomFields,
              }),
            )}
            className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
          >
            <Select aria-label="Type" {...register("type")}>
              {OFFER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
            <Select aria-label="Statut" {...register("status")}>
              {OFFER_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
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
            <OfferImagesEditor
              images={images}
              onChange={(next) => setValue("images", next, { shouldDirty: true })}
            />
            <Input
              type="number"
              step="0.01"
              placeholder="Prix"
              aria-label="Prix"
              {...register("pricing.amount", { valueAsNumber: true })}
            />
            <Input placeholder="Devise (EUR)" {...register("pricing.currency")} />
            {errors.pricing?.currency && (
              <p className="col-span-2 text-xs text-destructive">
                {errors.pricing.currency.message}
              </p>
            )}
            <div className="col-span-2 flex items-center gap-2">
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="Prix avant promotion (optionnel)"
              aria-label="Prix avant promotion"
              disabled={compareAtLocked}
              className="flex-1"
              {...register("compareAtPrice", {
                // Emptied on edit means "remove the promotion", hence null rather than undefined.
                setValueAs: (v: string | number | null) => (v === "" || v == null ? null : Number(v)),
              })}
            />
              {compareAtLocked && <PlanLock feature="compare_at_price" />}
            </div>
            {fields.reference && <Input placeholder="Référence (SKU)" {...register("sku")} />}
            {fields.barcode && (
              <Input placeholder="Code-barres (EAN/UPC)" {...register("barcode")} />
            )}
            {fields.duration && (
              <Select aria-label="Vendu" className="col-span-2" {...register("bookingUnit")}>
                <option value="slot">Par créneau (rendez-vous, séance, cours)</option>
                <option value="night">Par nuit (séjour, de la date d&apos;arrivée à la date de départ)</option>
              </Select>
            )}
            {fields.duration && bookingUnit === "night" && (
              <Input
                type="number"
                min="1"
                step="1"
                aria-label="Séjour minimum (nuits)"
                placeholder="Séjour minimum en nuits (optionnel)"
                className="col-span-2"
                {...register("minNights", {
                  setValueAs: (v: string | number | null) => (v === "" || v == null ? null : Number(v)),
                })}
              />
            )}
            {fields.duration && bookingUnit !== "night" && (
              <Input
                type="number"
                min="0"
                max="240"
                step="5"
                aria-label="Temps de battement après (minutes)"
                placeholder="Temps de battement après chaque rendez-vous, en minutes (optionnel)"
                className="col-span-2"
                {...register("bufferMinutes", {
                  setValueAs: (v: string | number | null) => (v === "" || v == null ? null : Number(v)),
                })}
              />
            )}
            {fields.duration && bookingUnit !== "night" && (
              <Input
                type="number"
                step="5"
                min={OFFER_MIN_DURATION_MINUTES}
                max={OFFER_MAX_DURATION_MINUTES}
                aria-label="Durée de la prestation (minutes)"
                placeholder="Durée de la prestation (minutes)"
                className="col-span-2"
                {...register("durationMinutes", {
                  setValueAs: (v: string | number | null) =>
                    v === "" || v == null ? null : Number(v),
                })}
              />
            )}
            {errors.durationMinutes && (
              <p className="col-span-2 text-xs text-destructive">
                Durée entre {OFFER_MIN_DURATION_MINUTES} et {OFFER_MAX_DURATION_MINUTES} minutes.
              </p>
            )}
            {fields.stock && (
              <label className="col-span-2 flex items-center gap-2 text-sm text-text-muted">
                <input type="checkbox" {...register("trackStock")} />
                Suivre le stock pour cette offre
              </label>
            )}
            {fields.stock && trackStock && variantDrafts.length === 0 && (
              <Input
                type="number"
                step="1"
                placeholder="Stock"
                className="col-span-2"
                {...register("stockOnHand", {
                  setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
                })}
              />
            )}
            {fields.stock && trackStock && (
              <Input
                type="number"
                step="1"
                min="0"
                placeholder="Seuil d'alerte stock bas (optionnel)"
                className="col-span-2"
                {...register("lowStockThreshold", {
                  setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
                })}
              />
            )}
            {fields.variants && (
              <VariantsEditor
                variants={variantDrafts}
                onChange={setVariantDrafts}
                trackStock={!!trackStock}
                canAdd={has("offer_variants")}
              />
            )}
            {fields.bundle && (
              <BundleItemsEditor
                items={bundleDrafts}
                onChange={setBundleDrafts}
                excludeOfferId={id}
              />
            )}
            {fields.options && (
              <OptionGroupsEditor groups={optionGroupDrafts} onChange={setOptionGroupDrafts} />
            )}
            {fields.attributes && (
              <>
                {guidedFields.length > 0 && (
                  <GuidedFieldsEditor
                    fields={guidedFields}
                    attributes={attributeDrafts}
                    onChange={setGuidedAttribute}
                  />
                )}
                <AttributesEditor attributes={freeAttributes} onChange={setFreeAttributes} />
              </>
            )}

            <CustomFieldsFieldset
              entity="offers"
              values={editCustomFields}
              onChange={setEditCustomFields}
              idPrefix="offer-edit"
            />

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
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                <tr>
                  <th className="px-4 py-2">Variante</th>
                  <th className="px-4 py-2">SKU</th>
                  <th className="px-4 py-2">Prix</th>
                  {offer.trackStock && <th className="px-4 py-2">Stock</th>}
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
                    {offer.trackStock && (
                      <td className="px-4 py-2">
                        <VariantStockCell
                          offerId={id}
                          variantId={variant.id}
                          stockOnHand={variant.stockOnHand ?? 0}
                          onAdjust={(stockOnHand) =>
                            adjustStockMutation.mutate({ stockOnHand, variantId: variant.id })
                          }
                          adjusting={adjustStockMutation.isPending}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {offer.trackStock && <StockLevelsSection offerId={id} variants={offer.variants} />}
      {offer.trackStock && <StockMovementsSection offerId={id} variants={offer.variants} />}
    </div>
  );
}

/** Read-only per-warehouse breakdown (Phase C2) — empty for any offer that has never had a
 *  warehouse-scoped stock operation applied to it (see OffersService.adjustStock/
 *  recordStockMovement's `warehouseId` parameter). Hidden entirely once there's nothing to show,
 *  so an org that never uses multiple warehouses never sees an empty section. */
function StockLevelsSection({
  offerId,
  variants,
}: {
  offerId: string;
  variants: Offer["variants"];
}) {
  const authReady = useAuthReady();
  const levelsQuery = useQuery({
    queryKey: ["offers", offerId, "stock-levels"],
    enabled: authReady,
    queryFn: () => apiClient.get<StockLevel[]>(`/offers/${offerId}/stock/levels`),
  });
  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    enabled: authReady,
    queryFn: () => apiClient.get<Warehouse[]>("/warehouses"),
  });
  const levels = levelsQuery.data;
  const warehouses = warehousesQuery.data;

  if (!levels || levels.length === 0) return null;

  function warehouseName(warehouseId: string): string {
    return warehouses?.find((w) => w.id === warehouseId)?.name ?? "—";
  }
  function variantName(variantId?: string | null): string {
    if (!variantId) return "—";
    return variants.find((v) => v.id === variantId)?.name ?? "—";
  }

  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold text-text">Stock par entrepôt</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
            <tr>
              <th className="px-3 py-2">Entrepôt</th>
              {variants.length > 0 && <th className="px-3 py-2">Variante</th>}
              <th className="px-3 py-2">Quantité</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {levels.map((level) => (
              <tr key={level.id}>
                <td className="px-3 py-2 font-medium">{warehouseName(level.warehouseId)}</td>
                {variants.length > 0 && (
                  <td className="px-3 py-2 text-text-muted">{variantName(level.variantId)}</td>
                )}
                <td className="px-3 py-2">{level.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Inline "N — Ajuster" control for one variant row — a full form per row would be noisy for
 *  what's usually a quick correction; toggling a small input in place matches this table's own
 *  density. */
function VariantStockCell({
  stockOnHand,
  onAdjust,
  adjusting,
}: {
  offerId: string;
  variantId: string;
  stockOnHand: number;
  onAdjust: (stockOnHand: number) => void;
  adjusting: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(stockOnHand));

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(stockOnHand));
          setEditing(true);
        }}
        className="text-text underline-offset-2 hover:underline"
      >
        {stockOnHand}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        step="1"
        min="0"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-20"
        autoFocus
      />
      <Button
        variant="ghost"
        size="sm"
        loading={adjusting}
        onClick={() => {
          onAdjust(Number(value));
          setEditing(false);
        }}
      >
        OK
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
        ✕
      </Button>
    </div>
  );
}

/** The "logistics" side: a delta-with-reason entry (supplier delivery, breakage, a signed
 *  correction) plus the resulting movement history — distinct from the absolute-set "Ajuster"
 *  controls above (a stocktake correction), this is what actually explains *why* stock changed. */
function StockMovementsSection({
  offerId,
  variants,
}: {
  offerId: string;
  variants: Offer["variants"];
}) {
  const authReady = useAuthReady();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<RecordStockMovementInput>({
    resolver: zodResolver(recordStockMovementSchema),
    defaultValues: { type: "received", quantity: 1 },
  });
  const movementType = watch("type");

  const recordMutation = useMutation({
    mutationFn: (input: RecordStockMovementInput) =>
      apiClient.post(`/offers/${offerId}/stock/movements`, input),
    onSuccess: () => {
      reset({ type: "received", quantity: 1 });
      setPage(1);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ["offers", offerId] }),
        queryClient.invalidateQueries({ queryKey: ["stock-movements", offerId] }),
        queryClient.invalidateQueries({ queryKey: ["offers", offerId, "stock-levels"] }),
      ]);
    },
  });

  const movementsQuery = useQuery({
    queryKey: ["stock-movements", offerId, page],
    enabled: authReady,
    queryFn: () =>
      apiClient.getList<StockMovement>(`/offers/${offerId}/stock/movements?page=${page}`),
  });
  const movements = movementsQuery.data?.data;

  // Phase C2 (docs/KORVA_OS_V2_AUDIT.md §2.4) — optional: recording a movement with no warehouse
  // keeps today's exact aggregate-only behavior.
  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    enabled: authReady,
    queryFn: () => apiClient.get<Warehouse[]>("/warehouses"),
  });
  const warehouses = warehousesQuery.data;

  return (
    <Card className="p-6">
      <h2 className="text-sm font-semibold text-text">Mouvements de stock</h2>

      <form
        onSubmit={handleSubmit((values) => recordMutation.mutate(values))}
        className="mt-3 flex flex-wrap items-end gap-2"
      >
        <Select aria-label="Type de mouvement" {...register("type")}>
          {MANUAL_STOCK_MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {STOCK_MOVEMENT_LABELS[type]}
            </option>
          ))}
        </Select>
        {variants.length > 0 && (
          <Select aria-label="Variante" {...register("variantId")}>
            {variants.map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.name}
              </option>
            ))}
          </Select>
        )}
        {warehouses && warehouses.length > 0 && (
          <Select
            aria-label="Entrepôt"
            {...register("warehouseId", {
              setValueAs: (v: string) => (v === "" ? undefined : v),
            })}
          >
            <option value="">Aucun entrepôt (global)</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </Select>
        )}
        <Input
          type="number"
          step="1"
          aria-label="Quantité"
          placeholder={movementType === "correction" ? "± Quantité" : "Quantité"}
          className="w-32"
          {...register("quantity", { valueAsNumber: true })}
        />
        <Input
          placeholder="Motif (optionnel)"
          className="w-56"
          {...register("reason")}
        />
        <Button type="submit" size="sm" loading={recordMutation.isPending}>
          Enregistrer
        </Button>
      </form>
      {errors.quantity && (
        <p className="mt-1 text-xs text-destructive">{errors.quantity.message}</p>
      )}
      {recordMutation.isError && (
        <p className="mt-1 text-xs text-destructive">
          {recordMutation.error instanceof ApiError
            ? recordMutation.error.message
            : "Impossible d'enregistrer ce mouvement."}
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Quantité</th>
              <th className="px-3 py-2">Stock après</th>
              <th className="px-3 py-2">Motif</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {movementsQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-text-muted">
                  Chargement...
                </td>
              </tr>
            )}
            {!movementsQuery.isLoading && movements?.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-text-muted">
                  Aucun mouvement enregistré.
                </td>
              </tr>
            )}
            {movements?.map((movement) => (
              <tr key={movement.id}>
                <td className="px-3 py-2 text-text-muted">
                  {new Date(movement.createdAt).toLocaleDateString("fr-FR")}
                </td>
                <td className="px-3 py-2">{STOCK_MOVEMENT_LABELS[movement.type]}</td>
                <td
                  className={`px-3 py-2 font-medium ${
                    movement.quantity < 0 ? "text-destructive" : "text-success"
                  }`}
                >
                  {movement.quantity > 0 ? `+${movement.quantity}` : movement.quantity}
                </td>
                <td className="px-3 py-2 text-text-muted">{movement.stockAfter}</td>
                <td className="px-3 py-2 text-text-muted">{movement.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {movementsQuery.data && movementsQuery.data.pagination.totalPages > 1 && (
        <div className="mt-3">
          <Pagination
            page={movementsQuery.data.pagination.page}
            totalPages={movementsQuery.data.pagination.totalPages}
            onPageChange={setPage}
            disabled={movementsQuery.isFetching}
          />
        </div>
      )}
    </Card>
  );
}
