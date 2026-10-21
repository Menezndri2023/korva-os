"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Offer, OfferFieldDefinition, OfferOptionGroup, OfferType } from "@korva/types";
import { Button, Input, Select } from "@korva/ui";
import { apiClient } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";
import { PlanLock } from "@/components/plan-lock";

/**
 * Which parts of the offer form apply to each offer type. One table, read by both the creation
 * and the edit form, so a coiffeur creating a "Réservation" never sees SKU, barcode and stock,
 * and a shop creating a "Produit" never sees a service duration.
 *
 * The price before promotion (compareAtPrice) applies to every type and is not listed here.
 */
export const OFFER_TYPE_FIELDS: Record<
  OfferType,
  {
    reference: boolean;
    barcode: boolean;
    stock: boolean;
    variants: boolean;
    attributes: boolean;
    duration: boolean;
    bundle: boolean;
    options: boolean;
  }
> = {
  product: { reference: true, barcode: true, stock: true, variants: true, attributes: true, duration: false, bundle: false, options: true },
  digital_product: { reference: true, barcode: false, stock: false, variants: false, attributes: true, duration: false, bundle: false, options: false },
  service: { reference: false, barcode: false, stock: false, variants: false, attributes: true, duration: false, bundle: false, options: false },
  booking: { reference: false, barcode: false, stock: false, variants: false, attributes: true, duration: true, bundle: false, options: false },
  subscription: { reference: false, barcode: false, stock: false, variants: false, attributes: true, duration: false, bundle: false, options: false },
  package: { reference: true, barcode: false, stock: false, variants: false, attributes: true, duration: false, bundle: true, options: true },
};

const FIELD =
  "rounded-md border border-border-input px-2 py-1.5 text-sm focus:border-focus focus:outline-none";

/** One variant as the form edits it. `id` is set for a variant that already exists and must keep
 *  it (see OffersService's mergeVariants); its stock is then read-only here — it moves through
 *  the stock section, which keeps a ledger. */
export interface VariantDraft {
  id?: string;
  name: string;
  sku?: string;
  barcode?: string;
  priceOverride?: number;
  stockOnHand?: number;
}

function optionalNumber(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}
function optionalText(value: string): string | undefined {
  return value === "" ? undefined : value;
}

export function VariantsEditor({
  variants,
  onChange,
  trackStock,
  canAdd = true,
}: {
  variants: VariantDraft[];
  onChange: (next: VariantDraft[]) => void;
  trackStock: boolean;
  /** False when the plan does not include variants: existing ones stay editable, none added. */
  canAdd?: boolean;
}) {
  function update(index: number, patch: Partial<VariantDraft>) {
    onChange(variants.map((variant, i) => (i === index ? { ...variant, ...patch } : variant)));
  }

  return (
    <fieldset className="col-span-2 space-y-2">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-medium text-text">Variantes</legend>
        {canAdd ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onChange([...variants, { name: "" }])}
          >
            Ajouter une variante
          </Button>
        ) : (
          <PlanLock feature="offer_variants" />
        )}
      </div>
      {variants.length === 0 ? (
        <p className="text-xs text-text-muted">
          Aucune variante. Ajoutez-en pour vendre plusieurs tailles, couleurs ou formats avec un
          prix et un stock propres.
        </p>
      ) : (
        <ul className="space-y-2">
          {variants.map((variant, index) => (
            <li key={variant.id ?? `new-${index}`} className="flex flex-wrap items-center gap-2">
              <input
                aria-label={`Nom de la variante ${index + 1}`}
                placeholder="Nom (ex. M, Rouge)"
                className={`${FIELD} w-36`}
                value={variant.name}
                onChange={(e) => update(index, { name: e.target.value })}
              />
              <input
                aria-label={`Référence de la variante ${index + 1}`}
                placeholder="Référence"
                className={`${FIELD} w-28`}
                value={variant.sku ?? ""}
                onChange={(e) => update(index, { sku: optionalText(e.target.value) })}
              />
              <input
                aria-label={`Prix de la variante ${index + 1}`}
                placeholder="Prix (si différent)"
                type="number"
                step="0.01"
                min="0"
                className={`${FIELD} w-32`}
                value={variant.priceOverride ?? ""}
                onChange={(e) => update(index, { priceOverride: optionalNumber(e.target.value) })}
              />
              {trackStock &&
                (variant.id ? (
                  <span className="text-xs text-text-muted">
                    Stock : {variant.stockOnHand ?? 0}
                  </span>
                ) : (
                  <input
                    aria-label={`Stock initial de la variante ${index + 1}`}
                    placeholder="Stock initial"
                    type="number"
                    step="1"
                    min="0"
                    className={`${FIELD} w-28`}
                    value={variant.stockOnHand ?? ""}
                    onChange={(e) => update(index, { stockOnHand: optionalNumber(e.target.value) })}
                  />
                ))}
              <button
                type="button"
                aria-label={`Retirer la variante ${index + 1}`}
                onClick={() => onChange(variants.filter((_, i) => i !== index))}
                className="text-xs text-destructive hover:underline"
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/**
 * Free-form characteristics (Offer.attributes): matière, marque, équipements, surface... Edited as
 * rows so an empty key can be typed before its value; only complete rows are kept.
 */
export function AttributesEditor({
  attributes,
  onChange,
}: {
  attributes: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const [rows, setRows] = useState<{ key: string; value: string }[]>(() =>
    Object.entries(attributes).map(([key, value]) => ({ key, value })),
  );

  function commit(next: { key: string; value: string }[]) {
    setRows(next);
    const record: Record<string, string> = {};
    for (const row of next) {
      const key = row.key.trim();
      if (key && row.value.trim()) record[key] = row.value.trim();
    }
    onChange(record);
  }

  return (
    <fieldset className="col-span-2 space-y-2">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-medium text-text">Caractéristiques</legend>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRows([...rows, { key: "", value: "" }])}
        >
          Ajouter une caractéristique
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-text-muted">
          Par exemple : matière, marque, origine, équipements. Affichées sur la fiche publique.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2">
              <input
                aria-label={`Caractéristique ${index + 1}`}
                placeholder="Caractéristique (ex. Matière)"
                className={`${FIELD} w-44`}
                value={row.key}
                onChange={(e) =>
                  commit(rows.map((r, i) => (i === index ? { ...r, key: e.target.value } : r)))
                }
              />
              <input
                aria-label={`Valeur de la caractéristique ${index + 1}`}
                placeholder="Valeur (ex. Coton)"
                className={`${FIELD} flex-1`}
                value={row.value}
                onChange={(e) =>
                  commit(rows.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))
                }
              />
              <button
                type="button"
                aria-label={`Retirer la caractéristique ${index + 1}`}
                onClick={() => commit(rows.filter((_, i) => i !== index))}
                className="text-xs text-destructive hover:underline"
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

export interface BundleItemDraft {
  offerId: string;
  quantity: number;
}

/**
 * What a pack contains (Offer.bundleItems). Descriptive: selling a pack does not yet decrement
 * its components' stock — said in the form so nobody relies on it.
 */
export function BundleItemsEditor({
  items,
  onChange,
  excludeOfferId,
}: {
  items: BundleItemDraft[];
  onChange: (next: BundleItemDraft[]) => void;
  excludeOfferId?: string;
}) {
  const authReady = useAuthReady();
  const [pick, setPick] = useState("");
  const offersQuery = useQuery({
    queryKey: ["offers", "bundle-candidates"],
    queryFn: () => apiClient.getList<Offer>("/offers?page=1&limit=100"),
    enabled: authReady,
  });
  const candidates = (offersQuery.data?.data ?? []).filter(
    (offer) => offer.id !== excludeOfferId && !offer.isBundle,
  );
  const nameOf = (offerId: string) =>
    candidates.find((offer) => offer.id === offerId)?.name ?? "Offre";

  function add() {
    if (!pick) return;
    const existing = items.find((item) => item.offerId === pick);
    onChange(
      existing
        ? items.map((item) =>
            item.offerId === pick ? { ...item, quantity: item.quantity + 1 } : item,
          )
        : [...items, { offerId: pick, quantity: 1 }],
    );
    setPick("");
  }

  return (
    <fieldset className="col-span-2 space-y-2">
      <legend className="text-sm font-medium text-text">Contenu du pack</legend>
      <div className="flex gap-2">
        <Select
          aria-label="Offre à ajouter au pack"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="flex-1"
        >
          <option value="">Choisir une offre</option>
          {candidates.map((offer) => (
            <option key={offer.id} value={offer.id}>
              {offer.name}
            </option>
          ))}
        </Select>
        <Button type="button" variant="secondary" size="sm" disabled={!pick} onClick={add}>
          Ajouter au pack
        </Button>
      </div>
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item, index) => (
            <li key={item.offerId} className="flex items-center gap-2 text-sm">
              <span className="flex-1">{nameOf(item.offerId)}</span>
              <Input
                type="number"
                min="1"
                step="1"
                aria-label={`Quantité de ${nameOf(item.offerId)}`}
                value={item.quantity}
                onChange={(e) =>
                  onChange(
                    items.map((it, i) =>
                      i === index ? { ...it, quantity: Math.max(1, Number(e.target.value) || 1) } : it,
                    ),
                  )
                }
                className="w-20"
              />
              <button
                type="button"
                aria-label={`Retirer ${nameOf(item.offerId)} du pack`}
                onClick={() => onChange(items.filter((_, i) => i !== index))}
                className="text-xs text-destructive hover:underline"
              >
                Retirer
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-text-muted">
        Le pack est vendu à son propre prix. Sa vente ne décompte pas encore le stock des offres
        qu&apos;il contient.
      </p>
    </fieldset>
  );
}

/**
 * Choices made when ordering this offer (cuisson, taille, suppléments...). Each group is either a
 * single choice or a multiple choice up to a maximum, and may be required. Prices added by an
 * option are checked again by the API when the order is placed.
 */
export function OptionGroupsEditor({
  groups,
  onChange,
}: {
  groups: OfferOptionGroup[];
  onChange: (next: OfferOptionGroup[]) => void;
}) {
  function updateGroup(index: number, patch: Partial<OfferOptionGroup>) {
    onChange(groups.map((group, i) => (i === index ? { ...group, ...patch } : group)));
  }

  return (
    <fieldset className="col-span-2 space-y-3">
      <div className="flex items-center justify-between">
        <legend className="text-sm font-medium text-text">Options et suppléments</legend>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange([
              ...groups,
              {
                id: crypto.randomUUID(),
                name: "",
                required: false,
                maxChoices: 1,
                options: [{ id: crypto.randomUUID(), name: "", priceDelta: 0 }],
              },
            ])
          }
        >
          Ajouter un groupe d&apos;options
        </Button>
      </div>
      {groups.length === 0 && (
        <p className="text-xs text-text-muted">
          Par exemple : cuisson, taille, accompagnement, suppléments payants.
        </p>
      )}
      {groups.map((group, groupIndex) => (
        <div key={group.id} className="space-y-2 rounded-md border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={`Nom du groupe ${groupIndex + 1}`}
              placeholder="Nom du groupe (ex. Taille)"
              className={`${FIELD} w-48`}
              value={group.name}
              onChange={(e) => updateGroup(groupIndex, { name: e.target.value })}
            />
            <label className="flex items-center gap-1 text-xs text-text">
              <input
                type="checkbox"
                checked={group.required}
                onChange={(e) => updateGroup(groupIndex, { required: e.target.checked })}
              />
              Obligatoire
            </label>
            <label className="flex items-center gap-1 text-xs text-text">
              Choix maximum
              <input
                aria-label={`Choix maximum du groupe ${groupIndex + 1}`}
                type="number"
                min="1"
                max={group.options.length}
                className={`${FIELD} w-16`}
                value={group.maxChoices}
                onChange={(e) =>
                  updateGroup(groupIndex, {
                    maxChoices: Math.min(
                      Math.max(1, Number(e.target.value) || 1),
                      group.options.length,
                    ),
                  })
                }
              />
            </label>
            <button
              type="button"
              aria-label={`Retirer le groupe ${groupIndex + 1}`}
              onClick={() => onChange(groups.filter((_, i) => i !== groupIndex))}
              className="ml-auto text-xs text-destructive hover:underline"
            >
              Retirer le groupe
            </button>
          </div>
          <ul className="space-y-1">
            {group.options.map((option, optionIndex) => (
              <li key={option.id} className="flex flex-wrap items-center gap-2">
                <input
                  aria-label={`Option ${optionIndex + 1} du groupe ${groupIndex + 1}`}
                  placeholder="Option (ex. Grand)"
                  className={`${FIELD} w-48`}
                  value={option.name}
                  onChange={(e) =>
                    updateGroup(groupIndex, {
                      options: group.options.map((o, i) =>
                        i === optionIndex ? { ...o, name: e.target.value } : o,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`Supplément de l'option ${optionIndex + 1} du groupe ${groupIndex + 1}`}
                  placeholder="Supplément"
                  type="number"
                  min="0"
                  step="0.01"
                  className={`${FIELD} w-28`}
                  value={option.priceDelta}
                  onChange={(e) =>
                    updateGroup(groupIndex, {
                      options: group.options.map((o, i) =>
                        i === optionIndex ? { ...o, priceDelta: Number(e.target.value) || 0 } : o,
                      ),
                    })
                  }
                />
                {group.options.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Retirer l'option ${optionIndex + 1} du groupe ${groupIndex + 1}`}
                    onClick={() => {
                      const options = group.options.filter((_, i) => i !== optionIndex);
                      updateGroup(groupIndex, {
                        options,
                        maxChoices: Math.min(group.maxChoices, options.length),
                      });
                    }}
                    className="text-xs text-destructive hover:underline"
                  >
                    Retirer
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() =>
              updateGroup(groupIndex, {
                options: [...group.options, { id: crypto.randomUUID(), name: "", priceDelta: 0 }],
              })
            }
            className="text-xs text-text hover:underline"
          >
            + Ajouter une option
          </button>
        </div>
      ))}
    </fieldset>
  );
}

/**
 * The guided characteristics of a type of activity (BUSINESS_MODEL_OFFER_FIELDS): a room's
 * capacity and amenities, a property's surface and rooms. Reads and writes the same
 * Offer.attributes the free characteristics editor does, under each field's label, so the
 * storefront shows them with no extra work. An emptied field is removed rather than stored blank.
 */
export function GuidedFieldsEditor({
  fields,
  attributes,
  onChange,
}: {
  fields: readonly OfferFieldDefinition[];
  attributes: Record<string, string>;
  onChange: (label: string, value: string | undefined) => void;
}) {
  return (
    <fieldset className="col-span-2 grid gap-2 sm:grid-cols-2">
      <legend className="col-span-2 mb-1 text-sm font-medium text-text">Détails</legend>
      {fields.map((field) => {
        const value = attributes[field.label] ?? "";
        const set = (next: string) => onChange(field.label, next.trim() === "" ? undefined : next);
        if (field.kind === "checklist") {
          const chosen = value ? value.split(", ") : [];
          return (
            <div key={field.label} className="sm:col-span-2">
              <p className="mb-1 text-xs text-text-muted">{field.label}</p>
              <div className="flex flex-wrap gap-3">
                {field.options?.map((option) => (
                  <label key={option} className="flex items-center gap-1.5 text-sm text-text">
                    <input
                      type="checkbox"
                      checked={chosen.includes(option)}
                      onChange={(e) =>
                        set(
                          (field.options ?? [])
                            .filter((o) =>
                              o === option ? e.target.checked : chosen.includes(o),
                            )
                            .join(", "),
                        )
                      }
                    />
                    {option}
                  </label>
                ))}
              </div>
            </div>
          );
        }
        if (field.kind === "select") {
          return (
            <Select
              key={field.label}
              aria-label={field.label}
              value={value}
              onChange={(e) => set(e.target.value)}
            >
              <option value="">{field.label}</option>
              {field.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          );
        }
        return (
          <Input
            key={field.label}
            type={field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}
            min={field.kind === "number" ? "0" : undefined}
            aria-label={field.label}
            placeholder={field.label}
            value={value}
            onChange={(e) => set(e.target.value)}
          />
        );
      })}
    </fieldset>
  );
}
