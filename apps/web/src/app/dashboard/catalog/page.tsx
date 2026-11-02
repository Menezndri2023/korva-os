"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createOfferSchema,
  OFFER_MAX_DURATION_MINUTES,
  OFFER_MIN_DURATION_MINUTES,
  type CreateOfferInput,
} from "@korva/validation";
import {
  BUSINESS_MODEL_DEFINITIONS,
  BUSINESS_MODEL_OFFER_FIELDS,
  OFFER_TYPES,
  verticalForOrganizationType,
  verticalText,
  type CustomFieldValues,
  type Offer,
  type OfferOptionGroup,
  type OfferType,
} from "@korva/types";
import { Badge, Button, Card, Input, Pagination, Select } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { useActiveOrganization } from "@/lib/use-active-organization";
import { CustomFieldsFieldset } from "@/components/custom-fields-fieldset";
import { OfferImagesEditor } from "@/components/offer-images-editor";
import { PlanLock } from "@/components/plan-lock";
import { usePlanFeatures } from "@/lib/use-plan-features";
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
import { OFFER_STATUS_LABELS, OFFER_TYPE_LABELS } from "@/lib/catalog-labels";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

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
  const { data: organization } = useActiveOrganization();
  const locale = useDashboardLocale();
  const t = useT();
  const typeLabel = (type: OfferType) => t(...OFFER_TYPE_LABELS[type]);
  // Best-effort: `Organization.type` is free-form, so an owner who typed their own sector simply
  // gets no suggestions rather than the wrong trade's.
  const vertical = verticalForOrganizationType(organization?.type);
  const verticalWords = vertical ? verticalText(vertical, locale) : undefined;
  // The type of activity puts its own offer types first and picks the first one by default; the
  // others stay one click away (a salon may sell products too). Without one, every type is listed
  // in the usual order, as before.
  const businessModel = organization?.businessModel
    ? BUSINESS_MODEL_DEFINITIONS[organization.businessModel]
    : undefined;
  const recommendedOfferTypes = businessModel?.offerTypes ?? [...OFFER_TYPES];
  const otherOfferTypes = OFFER_TYPES.filter((type) => !recommendedOfferTypes.includes(type));

  const { data: offersPage, isLoading } = useQuery({
    queryKey: ["offers", typeFilter, page],
    queryFn: () =>
      apiClient.getList<Offer>(
        `/offers?page=${page}${typeFilter ? `&type=${typeFilter}` : ""}`,
      ),
    enabled: authReady,
  });
  const data = offersPage?.data;
  // Whether anything is on the public site at all — counted on its own, so the answer does not
  // depend on the page or the type filter shown. An offer saved as a draft is invisible to
  // customers, and a site with none online looks broken to them.
  const { data: onlinePage } = useQuery({
    queryKey: ["offers", "online-count"],
    queryFn: () => apiClient.getList<Offer>("/offers?page=1&limit=1&status=active"),
    enabled: authReady,
  });
  const nothingOnline =
    (offersPage?.pagination.total ?? 0) > 0 && onlinePage?.pagination.total === 0;

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
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

  /**
   * Opens the creation form, optionally pre-filled from one of the trade's suggestions.
   *
   * Always resets through here rather than relying on `defaultValues`, for the currency: that
   * object is evaluated once when the component mounts, before useActiveOrganization has
   * resolved, so the hardcoded "EUR" above was the currency EVERY organization got — an offer
   * created in Casablanca or Abidjan was priced in euros unless the owner noticed the field.
   * Resetting at open time means the organization has loaded by then.
   */
  function openForm(prefill?: { name: string; type: OfferType }) {
    reset({
      type: prefill?.type ?? recommendedOfferTypes[0] ?? "product",
      // A guesthouse sells nights; everyone else sells time slots.
      bookingUnit: organization?.businessModel === "lodging" ? "night" : "slot",
      name: prefill?.name ?? "",
      images: [],
      categories: [],
      variants: [],
      // Published by default: an owner creating an offer expects to see it on their site. New
      // offers used to be drafts with no way to publish them from this form.
      status: "active",
      pricing: { amount: 0, currency: organization?.currency ?? "EUR" },
      trackStock: false,
    });
    setCreateCustomFields({});
    setVariantDrafts([]);
    setAttributeDrafts({});
    setBundleDrafts([]);
    setOptionGroupDrafts([]);
    setFormKey((key) => key + 1);
    setShowForm(true);
  }
  const trackStock = watch("trackStock");
  const images = watch("images") ?? [];
  const offerType = watch("type");
  const bookingUnit = watch("bookingUnit") ?? "slot";
  const fields = OFFER_TYPE_FIELDS[offerType ?? "product"];
  const { has } = usePlanFeatures();
  // A promotion already on the offer stays editable after a downgrade; adding one needs the plan.
  const compareAtLocked = !has("compare_at_price");
  const [variantDrafts, setVariantDrafts] = useState<VariantDraft[]>([]);
  const [attributeDrafts, setAttributeDrafts] = useState<Record<string, string>>({});

  // Guided characteristics of the type of activity (a room's amenities, a property's surface),
  // for its main offer type only; the free editor then shows everything else.
  const businessModelKey = organization?.businessModel;
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
  // Remounts the attributes editor (which keeps its own rows) each time the form is reopened.
  const [formKey, setFormKey] = useState(0);

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
      <p className="text-sm text-text-muted">{t("Produits, services et autres offres.", "Products, services and other offers.")}</p>

      {nothingOnline && (
        <p className="rounded-md border border-border bg-surface-muted px-4 py-3 text-sm text-text">
          {t(
            "Aucune de vos offres n'est en ligne : votre site n'affiche rien pour l'instant. Ouvrez une offre et cliquez sur « Publier sur le site ».",
            "None of your offers is online: your website shows nothing yet. Open an offer and click “Publish on the website”.",
          )}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
        >
          <option value="">{t("Tous les types", "All types")}</option>
          {OFFER_TYPES.map((type) => (
            <option key={type} value={type}>
              {typeLabel(type)}
            </option>
          ))}
        </select>
        <Button onClick={() => (showForm ? setShowForm(false) : openForm())}>
          {showForm ? t("Annuler", "Cancel") : t("Nouvelle offre", "New offer")}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit((values) =>
            createMutation.mutate({
              ...pruneForType(values, {
                variants: variantDrafts,
                attributes: attributeDrafts,
                bundleItems: bundleDrafts,
                optionGroups: optionGroupDrafts,
              }),
              customFields: createCustomFields,
            }),
          )}
          // Not migrated to <Card>: this wrapper is the <form> element itself (it carries
          // onSubmit), and Card renders a <div> — same exclusion already documented on the
          // other migrated create-forms (dashboard/crm, dashboard/bookings).
          className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <select
            aria-label={t("Type d'offre", "Offer type")}
            className="col-span-2 rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            {...register("type")}
          >
            {otherOfferTypes.length === 0 ? (
              recommendedOfferTypes.map((type) => (
                <option key={type} value={type}>
                  {typeLabel(type)}
                </option>
              ))
            ) : (
              <>
                <optgroup label={t("Pour votre activité", "For your business")}>
                  {recommendedOfferTypes.map((type) => (
                    <option key={type} value={type}>
                      {typeLabel(type)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("Autres types", "Other types")}>
                  {otherOfferTypes.map((type) => (
                    <option key={type} value={type}>
                      {typeLabel(type)}
                    </option>
                  ))}
                </optgroup>
              </>
            )}
          </select>
          <Input placeholder={t("Nom", "Name")} className="col-span-2" {...register("name")} />
          {errors.name && <p className="col-span-2 text-xs text-destructive">{errors.name.message}</p>}
          <textarea
            placeholder={t("Description", "Description")}
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
            placeholder={t("Prix", "Price")}
            aria-label={t("Prix", "Price")}
            {...register("pricing.amount", { valueAsNumber: true })}
          />
          <Input placeholder={t("Devise (EUR)", "Currency (EUR)")} {...register("pricing.currency")} />
          {errors.pricing?.currency && (
            <p className="col-span-2 text-xs text-destructive">{errors.pricing.currency.message}</p>
          )}
          <div className="col-span-2 flex items-center gap-2">
          <Input
            type="number"
            step="0.01"
            min="0"
            placeholder={t("Prix avant promotion (optionnel)", "Price before discount (optional)")}
            aria-label={t("Prix avant promotion", "Price before discount")}
            disabled={compareAtLocked}
            className="flex-1"
            {...register("compareAtPrice", {
              setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
            })}
          />
            {compareAtLocked && <PlanLock feature="compare_at_price" />}
          </div>
          {fields.reference && <Input placeholder={t("Référence (SKU)", "Reference (SKU)")} {...register("sku")} />}
          {fields.barcode && <Input placeholder={t("Code-barres (EAN/UPC)", "Barcode (EAN/UPC)")} {...register("barcode")} />}
          {fields.duration && (
            <Select aria-label={t("Vendu", "Sold")} className="col-span-2" {...register("bookingUnit")}>
              <option value="slot">{t("Par créneau (rendez-vous, séance, cours)", "Per slot (appointment, session, class)")}</option>
              <option value="night">
                {t("Par nuit (séjour, de la date d'arrivée à la date de départ)", "Per night (stay, from arrival date to departure date)")}
              </option>
            </Select>
          )}
          {fields.duration && bookingUnit === "night" && (
            <Input
              type="number"
              min="1"
              step="1"
              aria-label={t("Séjour minimum (nuits)", "Minimum stay (nights)")}
              placeholder={t("Séjour minimum en nuits (optionnel)", "Minimum stay in nights (optional)")}
              className="col-span-2"
              {...register("minNights", {
                setValueAs: (v: string | number | null) => (v === "" || v == null ? undefined : Number(v)),
              })}
            />
          )}
          {fields.duration && bookingUnit !== "night" && (
            <Input
              type="number"
              min="0"
              max="240"
              step="5"
              aria-label={t("Temps de battement après (minutes)", "Buffer time after (minutes)")}
              placeholder={t(
                "Temps de battement après chaque rendez-vous, en minutes (optionnel)",
                "Buffer time after each appointment, in minutes (optional)",
              )}
              className="col-span-2"
              {...register("bufferMinutes", {
                setValueAs: (v: string | number | null) => (v === "" || v == null ? undefined : Number(v)),
              })}
            />
          )}
          {fields.duration && bookingUnit !== "night" && (
            <Input
              type="number"
              step="5"
              min={OFFER_MIN_DURATION_MINUTES}
              max={OFFER_MAX_DURATION_MINUTES}
              aria-label={t("Durée de la prestation (minutes)", "Service length (minutes)")}
              placeholder={t("Durée de la prestation (minutes)", "Service length (minutes)")}
              className="col-span-2"
              {...register("durationMinutes", {
                setValueAs: (v: string) => (v === "" ? undefined : Number(v)),
              })}
            />
          )}
          {errors.durationMinutes && (
            <p className="col-span-2 text-xs text-destructive">
              {t(
                `Durée entre ${OFFER_MIN_DURATION_MINUTES} et ${OFFER_MAX_DURATION_MINUTES} minutes.`,
                `Length between ${OFFER_MIN_DURATION_MINUTES} and ${OFFER_MAX_DURATION_MINUTES} minutes.`,
              )}
            </p>
          )}
          {fields.stock && (
            <label className="col-span-2 flex items-center gap-2 text-sm text-text-muted">
              <input type="checkbox" {...register("trackStock")} />
              {t("Suivre le stock pour cette offre", "Track stock for this offer")}
            </label>
          )}
          {fields.stock && trackStock && variantDrafts.length === 0 && (
            <Input
              type="number"
              step="1"
              placeholder={t("Stock initial", "Opening stock")}
              className="col-span-2"
              {...register("stockOnHand", {
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
            <BundleItemsEditor items={bundleDrafts} onChange={setBundleDrafts} />
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
              <AttributesEditor
                key={formKey}
                attributes={freeAttributes}
                onChange={setFreeAttributes}
              />
            </>
          )}

          <label className="col-span-2 flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={watch("status") !== "draft"}
              onChange={(e) => setValue("status", e.target.checked ? "active" : "draft")}
            />
            {t("Publier sur mon site", "Publish on my website")}
            <span className="text-xs text-text-muted">
              {t(
                "(décochez pour garder l'offre en brouillon, invisible de vos clients)",
                "(untick to keep the offer as a draft, hidden from your customers)",
              )}
            </span>
          </label>

          <CustomFieldsFieldset
            entity="offers"
            values={createCustomFields}
            onChange={setCreateCustomFields}
            idPrefix="offer-create"
          />

          {createMutation.isError && (
            <p className="col-span-2 text-sm text-destructive">
              {createMutation.error instanceof ApiError ? createMutation.error.message : t("Erreur", "Error")}
            </p>
          )}
          <Button type="submit" loading={createMutation.isPending} className="col-span-2">
            {createMutation.isPending ? t("Création...", "Creating...") : t("Créer l'offre", "Create the offer")}
          </Button>
        </form>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
              <tr>
                <th className="px-4 py-2">{t("Nom", "Name")}</th>
                <th className="px-4 py-2">{t("Type", "Type")}</th>
                <th className="px-4 py-2">{t("Prix", "Price")}</th>
                <th className="px-4 py-2">{t("Statut", "Status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-text-muted">
                    {t("Chargement...", "Loading...")}
                  </td>
                </tr>
              )}
              {!isLoading && data?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6">
                    {/* An empty catalogue blocks the whole product: no offers means nothing on
                        the public site and nothing to book or order. Rather than stating the
                        obvious, the empty state offers what this trade usually sells — names
                        only, from VERTICAL_TEMPLATES. Clicking one opens the form pre-filled so
                        the owner sets their own price; nothing is ever created for them. */}
                    {vertical?.suggestedOffers?.length && verticalWords ? (
                      <div className="text-center">
                        <p className="text-text-muted">
                          {t(
                            `Votre catalogue est vide. Voici ce que propose généralement un établissement du secteur « ${verticalWords.label} ».`,
                            `Your catalogue is empty. Here is what a business in “${verticalWords.label}” usually offers.`,
                          )}
                        </p>
                        <div className="mt-3 flex flex-wrap justify-center gap-2">
                          {vertical.suggestedOffers.map((suggestion) => (
                            <button
                              key={suggestion.name}
                              type="button"
                              onClick={() => openForm({ ...suggestion, name: verticalWords.offerName(suggestion.name) })}
                              className="rounded-full border border-border-input px-3 py-1.5 text-sm text-text transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                            >
                              {verticalWords.offerName(suggestion.name)}
                            </button>
                          ))}
                        </div>
                        <p className="mt-3 text-xs text-text-muted">
                          {t(
                            "Vous fixez vous-même le prix. Ce sont des suggestions, rien n'est créé sans vous.",
                            "You set the price yourself. These are suggestions; nothing is created without you.",
                          )}
                        </p>
                      </div>
                    ) : (
                      <p className="text-center text-text-muted">{t("Aucune offre.", "No offers.")}</p>
                    )}
                  </td>
                </tr>
              )}
              {data?.map((offer) => (
                <tr key={offer.id}>
                  <td className="px-4 py-2 font-medium">
                    <div className="flex items-center gap-3">
                      {/* The main photo, or an empty square so names stay aligned. Decorative
                          (alt=""): the link next to it already names the offer. */}
                      {offer.images[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- arbitrary/uploaded URL, not a static asset
                        <img
                          src={offer.images[0]}
                          alt=""
                          className="h-10 w-10 shrink-0 rounded object-cover"
                        />
                      ) : (
                        <span className="h-10 w-10 shrink-0 rounded bg-surface-muted" />
                      )}
                      <Link
                        href={`/dashboard/catalog/${offer.id}`}
                        className="text-text underline-offset-2 hover:underline"
                      >
                        {offer.name}
                      </Link>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-text-muted">{typeLabel(offer.type)}</td>
                  <td className="px-4 py-2 text-text-muted">
                    {offer.pricing.amount} {offer.pricing.currency}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={STATUS_VARIANT[offer.status]}>{t(...OFFER_STATUS_LABELS[offer.status])}</Badge>
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
