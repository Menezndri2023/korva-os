"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FULFILLMENT_MODES,
  FULFILLMENT_MODE_LABELS,
  FULFILLMENT_MODE_LABELS_EN,
  type DeliveryZone,
  type FulfillmentMode,
  type Organization,
} from "@korva/types";
import { Button, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";
import { useDashboardLocale, useT } from "@/lib/dashboard-locale";

const FIELD =
  "rounded-md border border-border-input px-2 py-1.5 text-sm focus:border-focus focus:outline-none";

function optionalNumber(value: string): number | undefined {
  return value === "" ? undefined : Number(value);
}

/**
 * How the business's storefront orders can be received: delivery (with zones, fees and minimum
 * basket), pickup, dine-in — plus pickup instructions and the preparation delay.
 *
 * Until a mode is ticked and saved, nothing changes for the organization: its storefront keeps
 * charging the flat shipping rate on every order, as it always did. The note under the modes says
 * so, because the first save is what switches the storefront to the new behaviour.
 *
 * Seeded from `organization` once, on mount — the parent renders it only when the organization
 * has loaded, same pattern as the storefront content editors.
 */
export function OrderReceptionSettings({ organization }: { organization: Organization }) {
  const locale = useDashboardLocale();
  const t = useT();
  const queryClient = useQueryClient();
  const [modes, setModes] = useState<FulfillmentMode[]>(organization.fulfillmentModes ?? []);
  const [zones, setZones] = useState<DeliveryZone[]>(organization.deliveryZones ?? []);
  const [pickupInstructions, setPickupInstructions] = useState(
    organization.pickupInstructions ?? "",
  );
  const [leadTime, setLeadTime] = useState(
    organization.orderLeadTimeMinutes != null ? String(organization.orderLeadTimeMinutes) : "",
  );
  const configuredBefore = (organization.fulfillmentModes ?? []).length > 0;

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.patch<Organization>("/organizations/me", {
        fulfillmentModes: modes,
        deliveryZones: zones
          .filter((zone) => zone.name.trim() !== "")
          .map((zone) => ({ ...zone, name: zone.name.trim() })),
        pickupInstructions: pickupInstructions.trim(),
        ...(leadTime !== "" ? { orderLeadTimeMinutes: Number(leadTime) } : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["organizations", "me"] }),
  });

  function toggleMode(mode: FulfillmentMode, checked: boolean) {
    setModes((current) =>
      checked
        ? FULFILLMENT_MODES.filter((m) => m === mode || current.includes(m))
        : current.filter((m) => m !== mode),
    );
  }
  function updateZone(index: number, patch: Partial<DeliveryZone>) {
    setZones((current) => current.map((zone, i) => (i === index ? { ...zone, ...patch } : zone)));
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-6">
      <h2 className="text-sm font-semibold text-text">{t("Réception des commandes", "Order fulfilment")}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {t(
          "Comment vos clients reçoivent ce qu'ils commandent sur votre site.",
          "How your customers receive what they order on your website.",
        )}
      </p>

      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-medium text-text">{t("Modes proposés", "Modes offered")}</legend>
        <div className="flex flex-wrap gap-4">
          {FULFILLMENT_MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={modes.includes(mode)}
                onChange={(e) => toggleMode(mode, e.target.checked)}
              />
              {(locale === "en" ? FULFILLMENT_MODE_LABELS_EN : FULFILLMENT_MODE_LABELS)[mode]}
            </label>
          ))}
        </div>
        {!configuredBefore && (
          <p className="text-xs text-text-muted">
            {t(
              "Tant que vous n'avez rien enregistré ici, votre site applique le tarif de livraison fixe à toutes les commandes, comme aujourd'hui.",
              "Until you save something here, your website applies the flat delivery fee to every order, as it does today.",
            )}
          </p>
        )}
      </fieldset>

      {modes.includes("delivery") && (
        <fieldset className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <legend className="text-xs font-medium text-text">{t("Zones de livraison", "Delivery zones")}</legend>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setZones((current) => [...current, { id: crypto.randomUUID(), name: "", fee: 0 }])
              }
            >
              {t("Ajouter une zone", "Add a zone")}
            </Button>
          </div>
          {zones.length === 0 ? (
            <p className="text-xs text-text-muted">
              {t(
                "Sans zone, la livraison coûte le tarif fixe défini dans le profil de l'entreprise.",
                "With no zone, delivery costs the flat fee set in the business profile.",
              )}
            </p>
          ) : (
            <ul className="space-y-2">
              {zones.map((zone, index) => (
                <li key={zone.id} className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Nom de la zone ${index + 1}`}
                    placeholder={t("Quartier, ville...", "Neighbourhood, town...")}
                    className={`${FIELD} w-44`}
                    value={zone.name}
                    onChange={(e) => updateZone(index, { name: e.target.value })}
                  />
                  <input
                    aria-label={`Frais de la zone ${index + 1}`}
                    placeholder={t("Frais", "Fee")}
                    type="number"
                    min="0"
                    step="0.01"
                    className={`${FIELD} w-28`}
                    value={zone.fee}
                    onChange={(e) => updateZone(index, { fee: Number(e.target.value) || 0 })}
                  />
                  <input
                    aria-label={`Minimum de commande de la zone ${index + 1}`}
                    placeholder={t("Minimum de commande", "Minimum order")}
                    type="number"
                    min="0"
                    step="0.01"
                    className={`${FIELD} w-44`}
                    value={zone.minimumOrder ?? ""}
                    onChange={(e) =>
                      updateZone(index, { minimumOrder: optionalNumber(e.target.value) })
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Retirer la zone ${index + 1}`}
                    onClick={() => setZones((current) => current.filter((_, i) => i !== index))}
                    className="text-xs text-destructive hover:underline"
                  >
                    {t("Retirer", "Remove")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}

      {modes.includes("pickup") && (
        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-text" htmlFor="pickup-instructions">
            {t("Instructions de retrait", "Collection instructions")}
          </label>
          <textarea
            id="pickup-instructions"
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={2}
            maxLength={500}
            placeholder={t("Adresse, horaires, à qui s'adresser...", "Address, hours, who to ask for...")}
            value={pickupInstructions}
            onChange={(e) => setPickupInstructions(e.target.value)}
          />
        </div>
      )}

      {modes.length > 0 && (
        <div className="mt-4 max-w-xs">
          <label className="mb-1 block text-xs font-medium text-text" htmlFor="order-lead-time">
            {t("Délai de préparation minimum (minutes)", "Minimum preparation time (minutes)")}
          </label>
          <Input
            id="order-lead-time"
            type="number"
            min="0"
            step="5"
            className="w-full"
            value={leadTime}
            onChange={(e) => setLeadTime(e.target.value)}
          />
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          loading={mutation.isPending}
          disabled={modes.length === 0}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? t("Enregistrement...", "Saving...") : t("Enregistrer", "Save")}
        </Button>
        {modes.length === 0 && (
          <p className="text-xs text-text-muted">{t(
            "Choisissez au moins un mode.",
            "Choose at least one mode.",
          )}</p>
        )}
        {mutation.isSuccess && <p className="text-xs text-success">{t("Enregistré.", "Saved.")}</p>}
        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : t("Erreur", "Error")}
          </p>
        )}
      </div>
    </section>
  );
}
