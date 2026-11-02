"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, Card } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { LineItem } from "@korva/types";
import { useT } from "@/lib/storefront-locale";

/**
 * "Demander un retour" widget for a fulfilled order — mirrors ReviewForm's shape (submit, show
 * server errors verbatim, collapse to a confirmation card on success). Eligibility (fulfilled
 * order, quantities not already returned) is enforced server-side by
 * ReturnRequestsService.create; this component just lets the customer pick which line items
 * and how many units, using the order's own item array index as the identifier (never an
 * offerId — see ReturnRequest's own doc comment for why two distinct line items can share one
 * offer).
 */
export function ReturnRequestForm({
  slug,
  orderId,
  items,
}: {
  slug: string;
  orderId: string;
  items: LineItem[];
}) {
  const t = useT();
  const { authFetch } = useCustomerAuth(slug);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  function toggleItem(index: number, maxQuantity: number) {
    setSelected((prev) => {
      const next = { ...prev };
      if (index in next) {
        delete next[index];
      } else {
        next[index] = maxQuantity;
      }
      return next;
    });
  }

  function setQuantity(index: number, quantity: number) {
    setSelected((prev) => ({ ...prev, [index]: quantity }));
  }

  const returnMutation = useMutation({
    mutationFn: () =>
      authFetch((token) =>
        publicApiClient.post(
          `/public/${slug}/account/returns`,
          {
            orderId,
            items: Object.entries(selected).map(([lineItemIndex, quantity]) => ({
              lineItemIndex: Number(lineItemIndex),
              quantity,
            })),
            reason: reason.trim(),
          },
          token,
        ),
      ),
  });

  if (returnMutation.isSuccess) {
    return (
      <Card className="p-4 text-sm text-text">
        {t(
          "Votre demande de retour a été envoyée — elle est en attente de validation.",
          "Your return request has been sent — it is waiting for approval.",
        )}
      </Card>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {t("Demander un retour", "Ask for a return")}
      </Button>
    );
  }

  const hasSelection = Object.values(selected).some((quantity) => quantity > 0);

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm font-medium text-text">{t("Demander un retour", "Ask for a return")}</p>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-center justify-between gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={index in selected}
                onChange={() => toggleItem(index, item.quantity)}
              />
              <span className="text-text">{item.description}</span>
            </label>
            {index in selected && (
              <input
                type="number"
                min={1}
                max={item.quantity}
                value={selected[index]}
                onChange={(event) =>
                  setQuantity(index, Math.min(item.quantity, Math.max(1, Number(event.target.value))))
                }
                className="w-16 rounded-md border border-border-input px-2 py-1 text-sm text-text focus:border-focus focus:outline-none"
              />
            )}
          </li>
        ))}
      </ul>
      <textarea
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={t("Motif du retour", "Reason for the return")}
        rows={2}
        className="w-full rounded-md border border-border-input px-3 py-2 text-sm text-text focus:border-focus focus:outline-none"
      />
      {returnMutation.isError && (
        <p className="text-xs text-destructive">
          {returnMutation.error instanceof PublicApiError
            ? returnMutation.error.message
            : t("Impossible d'envoyer votre demande de retour.", "Your return request could not be sent.")}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!hasSelection || !reason.trim()}
          loading={returnMutation.isPending}
          onClick={() => returnMutation.mutate()}
        >
          {t("Envoyer la demande", "Send the request")}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
          {t("Annuler", "Cancel")}
        </Button>
      </div>
    </Card>
  );
}
