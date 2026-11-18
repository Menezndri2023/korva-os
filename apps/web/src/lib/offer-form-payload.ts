import type { CreateOfferInput, UpdateOfferInput } from "@korva/validation";
import type { OfferOptionGroup } from "@korva/types";
import {
  OFFER_TYPE_FIELDS,
  type BundleItemDraft,
  type VariantDraft,
} from "@/components/offer-editors";

/**
 * The offer payload restricted to what the chosen type uses (OFFER_TYPE_FIELDS).
 *
 * react-hook-form keeps a value typed into a field even after that field is hidden, so an owner
 * who typed a SKU, switched the type to "Réservation" and saved would otherwise store a SKU on a
 * haircut. On creation a field that does not apply is simply left out; on edit (`clear: true`) it
 * is cleared, because leaving the key out would keep whatever was stored before the type changed.
 *
 * Variants, attributes and bundle items live in the editors' own state rather than in the form,
 * and are merged in here.
 */
export function pruneForType<T extends CreateOfferInput | UpdateOfferInput>(
  values: T,
  drafts: {
    variants: VariantDraft[];
    attributes: Record<string, string>;
    bundleItems: BundleItemDraft[];
    optionGroups?: OfferOptionGroup[];
  },
  { clear = false }: { clear?: boolean } = {},
): T {
  const fields = OFFER_TYPE_FIELDS[values.type ?? "product"];
  const gone = clear ? null : undefined;
  const variants = fields.variants
    ? drafts.variants
        .filter((variant) => variant.name.trim() !== "")
        .map((variant) => ({ ...variant, name: variant.name.trim() }))
    : [];
  const bundleItems = fields.bundle ? drafts.bundleItems : [];

  return {
    ...values,
    sku: fields.reference ? values.sku : clear ? "" : undefined,
    barcode: fields.barcode ? values.barcode : clear ? "" : undefined,
    trackStock: fields.stock ? values.trackStock : false,
    stockOnHand: fields.stock && variants.length === 0 ? values.stockOnHand : undefined,
    variants,
    attributes: fields.attributes ? drafts.attributes : {},
    isBundle: bundleItems.length > 0,
    bundleItems,
    // A stay has no duration (it runs from check-in to check-out); a slot has no minimum stay.
    durationMinutes:
      fields.duration && values.bookingUnit !== "night" ? values.durationMinutes : gone,
    bookingUnit: fields.duration ? values.bookingUnit : undefined,
    minNights: fields.duration && values.bookingUnit === "night" ? values.minNights : gone,
    bufferMinutes:
      fields.duration && values.bookingUnit !== "night" ? values.bufferMinutes : gone,
    // A deposit secures a booking, a slot or a stay alike.
    depositPercent: fields.duration ? values.depositPercent : gone,
    cancellationHours: fields.duration ? values.cancellationHours : gone,
    // A booking is priced by its slot or nights, never by the customer (the API refuses it).
    freeAmount: fields.duration ? (clear ? false : undefined) : values.freeAmount,
    // Groups and options left without a name are dropped, then empty groups with them.
    optionGroups: fields.options
      ? (drafts.optionGroups ?? [])
          .map((group) => ({
            ...group,
            name: group.name.trim(),
            options: group.options
              .filter((option) => option.name.trim() !== "")
              .map((option) => ({ ...option, name: option.name.trim() })),
          }))
          .filter((group) => group.name !== "" && group.options.length > 0)
          .map((group) => ({
            ...group,
            maxChoices: Math.min(group.maxChoices, group.options.length),
          }))
      : [],
  };
}
