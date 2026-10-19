"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createPublicBookingSchema,
  createPublicOrderSchema,
  type CreatePublicBookingInput,
  type CreatePublicOrderInput,
  type TrackCartCheckoutStartedInput,
} from "@korva/validation";
import type { PaymentMethod } from "@korva/types";
import { Button, Dialog, Input, Select } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import type { CartLine, PublicOffer, PublicResource, PublicSlots } from "@/lib/public-types";

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Espèces / à la livraison ou au retrait",
  online: "Paiement en ligne",
};

/** Lengths a visitor may pick for an offer with no duration of its own. An offer that has one
 *  (Offer.durationMinutes) never shows this choice — its length is the business's decision. */
const DURATIONS = [
  { label: "30 min", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "1h30", minutes: 90 },
  { label: "2h", minutes: 120 },
];

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, "0")}`;
}

/** Today's date as the visitor's own calendar shows it — `toISOString()` would give the UTC
 *  date, which is already tomorrow for an evening visitor in Montréal. */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Close control for the two panels below: @korva/ui's Dialog closes on Escape/backdrop click,
// but (per its own docstring) expects the caller to render any explicit close affordance inside
// `children` — this is that affordance.
function DialogCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Fermer"
      className="absolute right-4 top-4 text-sm text-text-muted hover:text-text"
    >
      ✕
    </button>
  );
}

export function BookingPanel({
  slug,
  offer,
  onClose,
  onSuccess,
}: {
  slug: string;
  offer: PublicOffer;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [date, setDate] = useState(localToday);
  const [chosenDuration, setChosenDuration] = useState(60);
  const fixedDuration = offer.durationMinutes;

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<CreatePublicBookingInput>({
    resolver: zodResolver(createPublicBookingSchema),
    defaultValues: {
      offerId: offer.id,
      resourceId: "",
      startAt: "",
      endAt: "",
      contact: { email: "", firstName: "", phone: "" },
    },
  });
  // useWatch rather than watch(): watch() makes the React Compiler skip this whole component.
  const [resourceId, startAt] = useWatch({ control, name: ["resourceId", "startAt"] });

  const resourcesQuery = useQuery({
    queryKey: ["public-resources", slug],
    queryFn: () => publicApiClient.get<PublicResource[]>(`/public/${slug}/resources`),
  });

  // Slots come from the API, already expressed in the business's own timezone. The panel used to
  // build startAt from the typed hour as `${date}T${time}:00.000Z` — UTC — so a 14:00 booking in
  // a Paris salon landed at 16:00, and the visitor also chose how long a fixed service lasted.
  const durationParam = fixedDuration ? "" : `&durationMinutes=${chosenDuration}`;
  const slotsQuery = useQuery({
    queryKey: ["public-slots", slug, offer.id, resourceId, date, fixedDuration ?? chosenDuration],
    queryFn: () =>
      publicApiClient.get<PublicSlots>(
        `/public/${slug}/slots?resourceId=${resourceId}&offerId=${offer.id}&date=${date}${durationParam}`,
      ),
    enabled: !!resourceId && !!date,
  });

  // Any change to what the slots depend on invalidates the one already picked.
  useEffect(() => {
    setValue("startAt", "");
    setValue("endAt", "");
  }, [resourceId, date, chosenDuration, setValue]);

  function pickSlot(slot: { startAt: string; endAt: string }) {
    setValue("startAt", slot.startAt);
    setValue("endAt", slot.endAt);
  }

  const bookMutation = useMutation({
    mutationFn: (values: CreatePublicBookingInput) =>
      publicApiClient.post(`/public/${slug}/bookings`, {
        ...values,
        contact: {
          email: values.contact.email,
          firstName: values.contact.firstName || undefined,
          phone: values.contact.phone || undefined,
        },
      }),
    onSuccess,
  });

  return (
    <Dialog open onClose={onClose} title={`Réserver — ${offer.name}`}>
      <DialogCloseButton onClose={onClose} />
      <form onSubmit={handleSubmit((values) => bookMutation.mutate(values))} className="space-y-3 text-sm">
        <div>
          <Select
            {...register("resourceId")}
            aria-label="Emplacement"
            error={!!errors.resourceId}
            className="w-full"
          >
            <option value="" disabled>
              Choisir un emplacement
            </option>
            {resourcesQuery.data?.map((resource) => (
              <option key={resource.id} value={resource.id}>
                {resource.name}
              </option>
            ))}
          </Select>
          {resourcesQuery.isError && (
            <p className="mt-1 text-xs text-destructive">
              Impossible de charger les emplacements.{" "}
              <button type="button" onClick={() => resourcesQuery.refetch()} className="underline">
                Réessayer
              </button>
            </p>
          )}
          {errors.resourceId && <p className="mt-1 text-xs text-destructive">{errors.resourceId.message}</p>}
        </div>

        <div className="flex gap-2">
          <Input
            type="date"
            aria-label="Date de réservation"
            value={date}
            min={localToday()}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1"
          />
          {fixedDuration ? (
            <p className="self-center text-xs text-text-muted">Durée : {formatDuration(fixedDuration)}</p>
          ) : (
            <Select
              aria-label="Durée"
              value={chosenDuration}
              onChange={(e) => setChosenDuration(Number(e.target.value))}
            >
              {DURATIONS.map((d) => (
                <option key={d.minutes} value={d.minutes}>
                  {d.label}
                </option>
              ))}
            </Select>
          )}
        </div>

        {resourceId && (
          <div>
            {slotsQuery.isLoading && <p className="text-xs text-text-muted">Chargement des créneaux...</p>}
            {slotsQuery.isError && (
              <p className="text-xs text-destructive">
                Impossible de charger les créneaux.{" "}
                <button type="button" onClick={() => slotsQuery.refetch()} className="underline">
                  Réessayer
                </button>
              </p>
            )}
            {slotsQuery.data &&
              (slotsQuery.data.slots.length ? (
                <div role="group" aria-label="Créneaux disponibles" className="flex flex-wrap gap-2">
                  {slotsQuery.data.slots.map((slot) => {
                    const selected = slot.startAt === startAt;
                    return (
                      <button
                        key={slot.startAt}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => pickSlot(slot)}
                        className={`rounded-md border px-3 py-1.5 text-xs ${
                          selected
                            ? "border-text bg-text text-surface"
                            : "border-border-input text-text hover:bg-surface-muted"
                        }`}
                      >
                        {slot.time}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-text-muted">Aucun créneau disponible ce jour-là.</p>
              ))}
          </div>
        )}

        <Input
          placeholder="Prénom"
          aria-label="Prénom"
          {...register("contact.firstName", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
          error={!!errors.contact?.firstName}
        />
        <div>
          <Input
            type="email"
            placeholder="E-mail"
            aria-label="Adresse e-mail"
            {...register("contact.email")}
            error={!!errors.contact?.email}
          />
          {errors.contact?.email && (
            <p className="mt-1 text-xs text-destructive">{errors.contact.email.message}</p>
          )}
        </div>
        <Input
          placeholder="Téléphone (optionnel)"
          aria-label="Téléphone"
          {...register("contact.phone", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
          error={!!errors.contact?.phone}
        />

        {bookMutation.isError && (
          <p className="text-xs text-destructive">
            {bookMutation.error instanceof PublicApiError ? bookMutation.error.message : "Erreur"}
          </p>
        )}
        <Button type="submit" loading={bookMutation.isPending} disabled={!startAt} className="w-full">
          {bookMutation.isPending ? "Envoi..." : "Confirmer la réservation"}
        </Button>
      </form>
    </Dialog>
  );
}

export function CheckoutPanel({
  slug,
  cart,
  currency,
  shippingFlatRate,
  acceptedPaymentMethods,
  customer,
  onClose,
  onSuccess,
}: {
  slug: string;
  cart: CartLine[];
  currency: string;
  shippingFlatRate?: number;
  /** Never empty — see PublicOrganization's own doc comment. A single entry renders no choice
   *  at all (today's exact pre-existing behavior when it's `["cash"]`). */
  acceptedPaymentMethods: PaymentMethod[];
  /** When the visitor is logged into the customer portal, pre-fills (but never locks) the
   *  contact fields below — guest checkout stays fully unchanged when this is undefined. */
  customer?: { email: string; firstName?: string; phone?: string };
  onClose: () => void;
  onSuccess: (orderNumber: string) => void;
}) {
  const itemsTotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const shippingCost = shippingFlatRate ?? 0;
  const total = itemsTotal + shippingCost;
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    acceptedPaymentMethods[0] ?? "cash",
  );
  const [redirecting, setRedirecting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<CreatePublicOrderInput>({
    resolver: zodResolver(createPublicOrderSchema),
    defaultValues: {
      items: cart.map((line) => ({
        offerId: line.offerId,
        variantId: line.variantId,
        quantity: line.quantity,
      })),
      currency,
      contact: {
        email: customer?.email ?? "",
        firstName: customer?.firstName ?? "",
        phone: customer?.phone ?? "",
      },
      discountCode: "",
      shippingAddress: { line1: "", line2: "", city: "", postalCode: "", country: "" },
    },
  });

  // Only ever called when paymentMethod === "online" — redirects the browser to the PSP's
  // hosted checkout page; there is nothing more for this dialog to render once that happens.
  const payMutation = useMutation({
    mutationFn: ({ orderId, email }: { orderId: string; email: string }) =>
      publicApiClient.post<{ checkoutUrl: string }>(
        `/public/${slug}/orders/${orderId}/pay`,
        { email },
      ),
    onSuccess: (result) => {
      setRedirecting(true);
      window.location.href = result.checkoutUrl;
    },
  });

  // Fire-and-forget: makes an otherwise backend-invisible, localStorage-only cart (use-cart.ts)
  // attributable to a real contact as soon as an email is known, so AbandonedCartReminderScheduler
  // can send a recovery message if checkout never completes. Never surfaced to the shopper —
  // no loading/error UI reads this mutation's state.
  const trackCheckoutMutation = useMutation({
    mutationFn: (input: TrackCartCheckoutStartedInput) =>
      publicApiClient.post(`/public/${slug}/cart-checkout-started`, input),
  });
  const emailField = register("contact.email");

  const orderMutation = useMutation({
    mutationFn: (values: CreatePublicOrderInput) =>
      publicApiClient.post<{ id: string; number: string }>(`/public/${slug}/orders`, {
        ...values,
        contact: {
          email: values.contact.email,
          firstName: values.contact.firstName || undefined,
          phone: values.contact.phone || undefined,
        },
        discountCode: values.discountCode || undefined,
        shippingAddress: values.shippingAddress,
      }),
    onSuccess: (order, values) => {
      if (paymentMethod === "online") {
        payMutation.mutate({ orderId: order.id, email: values.contact.email });
        return;
      }
      onSuccess(order.number);
    },
  });

  return (
    <Dialog open onClose={onClose} title="Finaliser la commande">
      <DialogCloseButton onClose={onClose} />
      <form onSubmit={handleSubmit((values) => orderMutation.mutate(values))} className="space-y-3 text-sm">
        <ul className="divide-y divide-border rounded-md border border-border">
          {cart.map((line) => (
            <li key={`${line.offerId}:${line.variantId ?? ""}`} className="flex justify-between px-3 py-2">
              <span>
                {line.name} × {line.quantity}
              </span>
              <span>
                {(line.unitPrice * line.quantity).toFixed(2)} {currency}
              </span>
            </li>
          ))}
        </ul>
        <div className="space-y-1 text-right text-sm">
          {shippingCost > 0 && (
            <p className="text-text-muted">
              Livraison : {shippingCost.toFixed(2)} {currency}
            </p>
          )}
          <p className="font-medium text-text">
            Total : {total.toFixed(2)} {currency}
          </p>
        </div>

        <Input
          placeholder="Code promo (optionnel)"
          aria-label="Code promo"
          {...register("discountCode")}
        />

        <Input
          placeholder="Prénom"
          aria-label="Prénom"
          {...register("contact.firstName", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
          error={!!errors.contact?.firstName}
        />
        <div>
          <Input
            type="email"
            placeholder="E-mail"
            aria-label="Adresse e-mail"
            {...emailField}
            onBlur={(event) => {
              void emailField.onBlur(event);
              const email = event.target.value.trim();
              if (!email || !email.includes("@")) return;
              trackCheckoutMutation.mutate({
                contact: { email },
                items: cart.map((line) => ({ offerId: line.offerId, quantity: line.quantity })),
              });
            }}
            error={!!errors.contact?.email}
          />
          {errors.contact?.email && (
            <p className="mt-1 text-xs text-destructive">{errors.contact.email.message}</p>
          )}
        </div>
        <Input
          placeholder="Téléphone (optionnel)"
          aria-label="Téléphone"
          {...register("contact.phone", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
          error={!!errors.contact?.phone}
        />

        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-text-muted">Adresse de livraison (optionnel)</p>
          <Input
            placeholder="Adresse"
            aria-label="Adresse"
            {...register("shippingAddress.line1")}
          />
          <Input
            placeholder="Complément d'adresse"
            aria-label="Complément d'adresse"
            {...register("shippingAddress.line2")}
          />
          <div className="flex gap-2">
            <Input
              placeholder="Ville"
              aria-label="Ville"
              className="flex-1"
              {...register("shippingAddress.city")}
            />
            <Input
              placeholder="Code postal"
              aria-label="Code postal"
              className="w-28"
              {...register("shippingAddress.postalCode")}
            />
          </div>
          <Input
            placeholder="Pays"
            aria-label="Pays"
            {...register("shippingAddress.country")}
          />
        </div>

        {acceptedPaymentMethods.length > 1 && (
          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-xs font-medium text-text-muted">Mode de paiement</p>
            {acceptedPaymentMethods.map((method) => (
              <label key={method} className="flex items-center gap-2 text-sm text-text">
                <input
                  type="radio"
                  name="paymentMethod"
                  value={method}
                  checked={paymentMethod === method}
                  onChange={() => setPaymentMethod(method)}
                />
                {PAYMENT_METHOD_LABELS[method]}
              </label>
            ))}
          </div>
        )}

        {errors.items && <p className="text-xs text-destructive">{errors.items.message ?? "Panier invalide."}</p>}
        {orderMutation.isError && (
          <p className="text-xs text-destructive">
            {orderMutation.error instanceof PublicApiError ? orderMutation.error.message : "Erreur"}
          </p>
        )}
        {payMutation.isError && (
          <p className="text-xs text-destructive">
            {payMutation.error instanceof PublicApiError
              ? payMutation.error.message
              : "Impossible de démarrer le paiement en ligne."}
          </p>
        )}
        <Button
          type="submit"
          loading={orderMutation.isPending || payMutation.isPending || redirecting}
          disabled={cart.length === 0}
          className="w-full"
        >
          {redirecting
            ? "Redirection vers le paiement..."
            : orderMutation.isPending || payMutation.isPending
              ? "Envoi..."
              : paymentMethod === "online"
                ? "Payer en ligne"
                : "Confirmer la commande"}
        </Button>
      </form>
    </Dialog>
  );
}
