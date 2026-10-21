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
import { FULFILLMENT_MODE_LABELS, type FulfillmentMode, type PaymentMethod } from "@korva/types";
import { Button, Dialog, Input, Select } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { optionKey } from "@/lib/use-cart";
import type {
  CartLine,
  PublicOffer,
  PublicOrganization,
  PublicResource,
  PublicSlots,
  PublicStayQuote,
} from "@/lib/public-types";

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

const STAY_UNAVAILABLE_LABELS: Record<string, string> = {
  STAY_TOO_SHORT: "Choisissez une date de départ après la date d'arrivée.",
  STAY_BELOW_MINIMUM: "Ce séjour est trop court pour cette offre.",
  SLOT_UNAVAILABLE: "Déjà réservé à ces dates.",
  SLOT_BLOCKED: "Fermé à ces dates.",
};

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
  const isStay = offer.bookingUnit === "night";
  const [checkIn, setCheckIn] = useState(localToday);
  const [checkOut, setCheckOut] = useState("");

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
      resourceId: undefined,
      // Undefined, not "": both are optional in the schema (a stay sends dates instead), and an
      // empty string fails its datetime format.
      startAt: undefined,
      endAt: undefined,
      contact: { email: "", firstName: "", phone: "" },
    },
  });
  // useWatch rather than watch(): watch() makes the React Compiler skip this whole component.
  const [resourceId, startAt] = useWatch({ control, name: ["resourceId", "startAt"] });

  const resourcesQuery = useQuery({
    queryKey: ["public-resources", slug],
    queryFn: () => publicApiClient.get<PublicResource[]>(`/public/${slug}/resources`),
  });
  const resources = resourcesQuery.data ?? [];
  const staffOnly = resources.length > 0 && resources.every((r) => r.type === "person");
  // Every bookable resource has seats: this is a restaurant's tables. The customer gives a party
  // size and picks a time; the API assigns the table (PublicService#bookAnyTable).
  const tableMode = !isStay && resources.length > 0 && resources.every((r) => r.seats != null);
  const [partySize, setPartySize] = useState(2);

  // Slots come from the API, already expressed in the business's own timezone. The panel used to
  // build startAt from the typed hour as `${date}T${time}:00.000Z` — UTC — so a 14:00 booking in
  // a Paris salon landed at 16:00, and the visitor also chose how long a fixed service lasted.
  const durationParam = fixedDuration ? "" : `&durationMinutes=${chosenDuration}`;
  const slotsQuery = useQuery({
    queryKey: tableMode
      ? ["public-table-slots", slug, offer.id, date, partySize]
      : ["public-slots", slug, offer.id, resourceId, date, fixedDuration ?? chosenDuration],
    queryFn: () =>
      publicApiClient.get<PublicSlots>(
        tableMode
          ? `/public/${slug}/table-slots?offerId=${offer.id}&date=${date}&partySize=${partySize}`
          : `/public/${slug}/slots?resourceId=${resourceId}&offerId=${offer.id}&date=${date}${durationParam}`,
      ),
    enabled: !!date && !isStay && (tableMode || !!resourceId),
  });
  useEffect(() => {
    setValue("partySize", tableMode ? partySize : undefined);
  }, [tableMode, partySize, setValue]);

  // A stay is priced and checked by the API before the customer commits (GET /stay-quote).
  const stayQuery = useQuery({
    queryKey: ["public-stay-quote", slug, offer.id, resourceId, checkIn, checkOut],
    queryFn: () =>
      publicApiClient.get<PublicStayQuote>(
        `/public/${slug}/stay-quote?offerId=${offer.id}&resourceId=${resourceId}&checkIn=${checkIn}&checkOut=${checkOut}`,
      ),
    enabled: isStay && !!resourceId && !!checkIn && !!checkOut,
  });
  useEffect(() => {
    if (!isStay) return;
    setValue("checkIn", checkIn);
    setValue("checkOut", checkOut || undefined);
  }, [isStay, checkIn, checkOut, setValue]);
  const stayReady = isStay && stayQuery.data?.available === true;

  // Any change to what the slots depend on invalidates the one already picked.
  useEffect(() => {
    setValue("startAt", undefined);
    setValue("endAt", undefined);
  }, [resourceId, date, chosenDuration, partySize, setValue]);

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
          {tableMode ? (
            <label className="flex items-center gap-2 text-sm text-text">
              Nombre de couverts
              <Input
                type="number"
                min="1"
                max="100"
                aria-label="Nombre de couverts"
                value={partySize}
                onChange={(e) => setPartySize(Math.max(1, Number(e.target.value) || 1))}
                className="w-20"
              />
            </label>
          ) : staffOnly ? (
            // A salon's customer books a person, not an "emplacement": show who they are.
            <div role="radiogroup" aria-label="Avec qui ?" className="space-y-1">
              <p className="text-xs font-medium text-text-muted">Avec qui ?</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {resources.map((resource) => (
                  <label
                    key={resource.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-md border p-2 ${
                      resourceId === resource.id ? "border-text" : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      value={resource.id}
                      className="sr-only"
                      {...register("resourceId")}
                    />
                    {resource.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- arbitrary/uploaded URL, not a static asset
                      <img src={resource.photo} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-sm text-text"
                      >
                        {resource.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text">{resource.name}</span>
                      {resource.description && (
                        <span className="block truncate text-xs text-text-muted">
                          {resource.description}
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : (
          <Select
            {...register("resourceId", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
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
          )}
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

        {isStay ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-text-muted">
                Arrivée
                <Input
                  type="date"
                  aria-label="Date d'arrivée"
                  value={checkIn}
                  min={localToday()}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className="mt-1 w-full"
                />
              </label>
              <label className="flex-1 text-xs text-text-muted">
                Départ
                <Input
                  type="date"
                  aria-label="Date de départ"
                  value={checkOut}
                  min={checkIn || localToday()}
                  onChange={(e) => setCheckOut(e.target.value)}
                  className="mt-1 w-full"
                />
              </label>
            </div>
            {stayQuery.data && (
              <p className={`text-xs ${stayQuery.data.available ? "text-text" : "text-destructive"}`}>
                {stayQuery.data.available
                  ? `${stayQuery.data.nights} nuit${stayQuery.data.nights > 1 ? "s" : ""} · ${stayQuery.data.total.toFixed(2)} ${stayQuery.data.currency}`
                  : STAY_UNAVAILABLE_LABELS[stayQuery.data.reason ?? ""] ?? "Indisponible à ces dates."}
              </p>
            )}
            {offer.minNights && offer.minNights > 1 && (
              <p className="text-xs text-text-muted">Séjour minimum : {offer.minNights} nuits.</p>
            )}
          </div>
        ) : (
          <>
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

        {(resourceId || tableMode) && (
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

          </>
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
        <Button
          type="submit"
          loading={bookMutation.isPending}
          disabled={isStay ? !stayReady : !startAt}
          className="w-full"
        >
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
  reception,
  acceptedPaymentMethods,
  customer,
  onClose,
  onSuccess,
}: {
  slug: string;
  cart: CartLine[];
  currency: string;
  shippingFlatRate?: number;
  /** The shop's fulfillment settings — usually the PublicOrganization itself. No modes means the
   *  older checkout: flat rate on every order, optional address. */
  reception?: Pick<
    PublicOrganization,
    "fulfillmentModes" | "deliveryZones" | "pickupInstructions" | "orderLeadTimeMinutes"
  >;
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
  const modes = reception?.fulfillmentModes ?? [];
  const zones = reception?.deliveryZones ?? [];
  const configured = modes.length > 0;
  const [mode, setMode] = useState<FulfillmentMode | undefined>(modes[0]);
  const [zoneId, setZoneId] = useState("");
  const [when, setWhen] = useState<"asap" | "later">("asap");
  const [requestedDate, setRequestedDate] = useState(localToday);
  const [requestedTime, setRequestedTime] = useState("");
  const [tableLabel, setTableLabel] = useState("");
  const zone = zones.find((candidate) => candidate.id === zoneId);
  // Mirrors resolveStorefrontFulfillment in the API, which stays the authority on the amount.
  const shippingCost = !configured
    ? (shippingFlatRate ?? 0)
    : mode === "delivery"
      ? zones.length > 0
        ? (zone?.fee ?? 0)
        : (shippingFlatRate ?? 0)
      : 0;
  const total = itemsTotal + shippingCost;
  const belowMinimum =
    mode === "delivery" && zone?.minimumOrder != null && itemsTotal < zone.minimumOrder;
  const needsZone = configured && mode === "delivery" && zones.length > 0 && !zone;
  const showAddress = !configured || mode === "delivery";
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
        optionIds: line.optionIds,
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
        shippingAddress: showAddress ? values.shippingAddress : undefined,
        ...(configured
          ? {
              fulfillmentMode: mode,
              deliveryZoneId: mode === "delivery" && zone ? zone.id : undefined,
              requestedFor:
                when === "later" && requestedTime
                  ? { date: requestedDate, time: requestedTime }
                  : undefined,
              tableLabel: mode === "dine_in" ? tableLabel.trim() || undefined : undefined,
            }
          : {}),
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
            <li key={`${line.offerId}:${line.variantId ?? ""}:${optionKey(line.optionIds)}`} className="flex justify-between px-3 py-2">
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

        {configured && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-text-muted">Réception</p>
            <div role="radiogroup" aria-label="Mode de réception" className="flex flex-wrap gap-3">
              {modes.map((candidate) => (
                <label key={candidate} className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="radio"
                    name="fulfillmentMode"
                    value={candidate}
                    checked={mode === candidate}
                    onChange={() => setMode(candidate)}
                  />
                  {FULFILLMENT_MODE_LABELS[candidate]}
                </label>
              ))}
            </div>

            {mode === "delivery" && zones.length > 0 && (
              <Select
                aria-label="Zone de livraison"
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                className="w-full"
              >
                <option value="">Choisir votre zone</option>
                {zones.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} — {candidate.fee.toFixed(2)} {currency}
                    {candidate.minimumOrder != null
                      ? ` (minimum ${candidate.minimumOrder.toFixed(2)} ${currency})`
                      : ""}
                  </option>
                ))}
              </Select>
            )}
            {belowMinimum && zone?.minimumOrder != null && (
              <p className="text-xs text-destructive">
                Commande minimum pour {zone.name} : {zone.minimumOrder.toFixed(2)} {currency}.
              </p>
            )}

            {mode === "pickup" && reception?.pickupInstructions && (
              <p className="text-xs text-text-muted">{reception.pickupInstructions}</p>
            )}

            {mode === "dine_in" && (
              <Input
                placeholder="Table (optionnel)"
                aria-label="Table"
                value={tableLabel}
                onChange={(e) => setTableLabel(e.target.value)}
              />
            )}

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="radio"
                  name="when"
                  checked={when === "asap"}
                  onChange={() => setWhen("asap")}
                />
                Dès que possible
              </label>
              <label className="flex items-center gap-2 text-sm text-text">
                <input
                  type="radio"
                  name="when"
                  checked={when === "later"}
                  onChange={() => setWhen("later")}
                />
                Choisir une heure
              </label>
            </div>
            {when === "later" && (
              <div className="flex gap-2">
                <Input
                  type="date"
                  aria-label="Date souhaitée"
                  value={requestedDate}
                  min={localToday()}
                  onChange={(e) => setRequestedDate(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="time"
                  aria-label="Heure souhaitée"
                  value={requestedTime}
                  onChange={(e) => setRequestedTime(e.target.value)}
                />
              </div>
            )}
          </div>
        )}

        {showAddress && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-text-muted">
            {configured ? "Adresse de livraison" : "Adresse de livraison (optionnel)"}
          </p>
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
        )}

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
          disabled={
            cart.length === 0 ||
            belowMinimum ||
            needsZone ||
            (configured && when === "later" && !requestedTime)
          }
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
