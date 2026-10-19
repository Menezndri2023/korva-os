"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FULFILLMENT_MODES,
  FULFILLMENT_MODE_LABELS,
  type DeliveryZone,
  type FulfillmentMode,
  type Organization,
} from "@korva/types";
import { Button, Input } from "@korva/ui";
import { apiClient, ApiError } from "@/lib/api-client";

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
      <h2 className="text-sm font-semibold text-text">Réception des commandes</h2>
      <p className="mt-1 text-sm text-text-muted">
        Comment vos clients reçoivent ce qu&apos;ils commandent sur votre site.
      </p>

      <fieldset className="mt-4 space-y-2">
        <legend className="text-xs font-medium text-text">Modes proposés</legend>
        <div className="flex flex-wrap gap-4">
          {FULFILLMENT_MODES.map((mode) => (
            <label key={mode} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={modes.includes(mode)}
                onChange={(e) => toggleMode(mode, e.target.checked)}
              />
              {FULFILLMENT_MODE_LABELS[mode]}
            </label>
          ))}
        </div>
        {!configuredBefore && (
          <p className="text-xs text-text-muted">
            Tant que vous n&apos;avez rien enregistré ici, votre site applique le tarif de livraison
            fixe à toutes les commandes, comme aujourd&apos;hui.
          </p>
        )}
      </fieldset>

      {modes.includes("delivery") && (
        <fieldset className="mt-4 space-y-2">
          <div className="flex items-center justify-between">
            <legend className="text-xs font-medium text-text">Zones de livraison</legend>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                setZones((current) => [...current, { id: crypto.randomUUID(), name: "", fee: 0 }])
              }
            >
              Ajouter une zone
            </Button>
          </div>
          {zones.length === 0 ? (
            <p className="text-xs text-text-muted">
              Sans zone, la livraison coûte le tarif fixe défini dans le profil de l&apos;entreprise.
            </p>
          ) : (
            <ul className="space-y-2">
              {zones.map((zone, index) => (
                <li key={zone.id} className="flex flex-wrap items-center gap-2">
                  <input
                    aria-label={`Nom de la zone ${index + 1}`}
                    placeholder="Quartier, ville..."
                    className={`${FIELD} w-44`}
                    value={zone.name}
                    onChange={(e) => updateZone(index, { name: e.target.value })}
                  />
                  <input
                    aria-label={`Frais de la zone ${index + 1}`}
                    placeholder="Frais"
                    type="number"
                    min="0"
                    step="0.01"
                    className={`${FIELD} w-28`}
                    value={zone.fee}
                    onChange={(e) => updateZone(index, { fee: Number(e.target.value) || 0 })}
                  />
                  <input
                    aria-label={`Minimum de commande de la zone ${index + 1}`}
                    placeholder="Minimum de commande"
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
                    Retirer
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
            Instructions de retrait
          </label>
          <textarea
            id="pickup-instructions"
            className="w-full rounded-md border border-border-input px-3 py-2 text-sm focus:border-focus focus:outline-none"
            rows={2}
            maxLength={500}
            placeholder="Adresse, horaires, à qui s'adresser..."
            value={pickupInstructions}
            onChange={(e) => setPickupInstructions(e.target.value)}
          />
        </div>
      )}

      {modes.length > 0 && (
        <div className="mt-4 max-w-xs">
          <label className="mb-1 block text-xs font-medium text-text" htmlFor="order-lead-time">
            Délai de préparation minimum (minutes)
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
          {mutation.isPending ? "Enregistrement..." : "Enregistrer"}
        </Button>
        {modes.length === 0 && (
          <p className="text-xs text-text-muted">Choisissez au moins un mode.</p>
        )}
        {mutation.isSuccess && <p className="text-xs text-success">Enregistré.</p>}
        {mutation.isError && (
          <p className="text-xs text-destructive">
            {mutation.error instanceof ApiError ? mutation.error.message : "Erreur"}
          </p>
        )}
      </div>
    </section>
  );
}
