"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createPublicBookingSchema,
  createPublicOrderSchema,
  type CreatePublicBookingInput,
  type CreatePublicLeadInput,
  type CreatePublicOrderInput,
  type TrackCartCheckoutStartedInput,
} from "@korva/validation";
import {
  FULFILLMENT_MODE_LABELS,
  FULFILLMENT_MODE_LABELS_EN,
  minimumOnlinePayment,
  PROVIDER_OBSERVED_XOF_RATES,
  type FulfillmentMode,
  type PaymentMethod,
} from "@korva/types";
import { Button, Dialog, Input, Select } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import { lineKey, MAX_LINE_QUANTITY, type CartActions } from "@/lib/use-cart";
import { requestLabel, type RequestKind } from "@/lib/request-kind";
import type {
  CartLine,
  PublicOffer,
  PublicOrganization,
  PublicResource,
  PublicSlots,
  PublicStayQuote,
} from "@/lib/public-types";
import { useStorefrontLocale, useT } from "@/lib/storefront-locale";

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, [string, string]> = {
  cash: ["Espèces / à la livraison ou au retrait", "Cash / on delivery or collection"],
  // The platform's online payment is mobile money first (GeniusPay: Wave, Orange Money, MTN,
  // Moov) with cards — say it in the words customers here use.
  online: ["Mobile money ou carte (Wave, Orange Money, MTN, Moov)", "Mobile money or card (Wave, Orange Money, MTN, Moov)"],
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
  const t = useT();
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={t("Fermer", "Close")}
      className="absolute right-4 top-4 text-sm text-text-muted hover:text-text"
    >
      ✕
    </button>
  );
}

const STAY_UNAVAILABLE_LABELS: Record<string, [string, string]> = {
  STAY_TOO_SHORT: ["Choisissez une date de départ après la date d'arrivée.", "Choose a departure date after the arrival date."],
  STAY_BELOW_MINIMUM: ["Ce séjour est trop court pour cette offre.", "This stay is too short for this offer."],
  SLOT_UNAVAILABLE: ["Déjà réservé à ces dates.", "Already booked on these dates."],
  SLOT_BLOCKED: ["Fermé à ces dates.", "Closed on these dates."],
};

/**
 * The on-site request — "Vitrine et demande de devis" for a business that works on quotes, a visit
 * for a property, information otherwise — sent as a lead to the business's CRM (POST
 * /public/:slug/leads), which alerts the business. Before it, such a site offered WhatsApp only.
 */
export function RequestPanel({
  slug,
  kind,
  offerName,
  onClose,
  onSuccess,
}: {
  slug: string;
  kind: RequestKind;
  offerName?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const t = useT();
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState(
    offerName
      ? kind === "quote"
        ? t(`Bonjour, je souhaite un devis pour « ${offerName} ».`, `Hello, I would like a quote for “${offerName}”.`)
        : kind === "visit"
          ? t(`Bonjour, je souhaite visiter « ${offerName} ».`, `Hello, I would like to visit “${offerName}”.`)
          : t(`Bonjour, je souhaite des renseignements sur « ${offerName} ».`, `Hello, I would like information about “${offerName}”.`)
      : "",
  );
  const send = useMutation({
    mutationFn: (input: CreatePublicLeadInput) => publicApiClient.post(`/public/${slug}/leads`, input),
    onSuccess,
  });

  return (
    <Dialog open onClose={onClose} title={t(...requestLabel(kind))}>
      <DialogCloseButton onClose={onClose} />
      <form
        className="space-y-3 text-sm"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate({
            message: message.trim(),
            source: kind === "quote" ? "website_quote" : kind === "visit" ? "website_visit" : "website_request",
            contact: {
              email: email.trim(),
              firstName: firstName.trim() || undefined,
              phone: phone.trim() || undefined,
            },
          });
        }}
      >
        <Input aria-label={t("Prénom", "First name")} placeholder={t("Prénom", "First name")} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
        <Input
          type="email"
          required
          aria-label={t("Adresse e-mail", "Email address")}
          placeholder={t("E-mail", "E-mail")}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input aria-label={t("Téléphone", "Phone")} placeholder={t("Téléphone (optionnel)", "Phone (optional)")} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">{t("Votre demande", "Your request")}</span>
          <textarea
            required
            maxLength={2000}
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="w-full rounded-md border border-border-input bg-surface px-3 py-2 text-sm text-text focus:border-focus focus:outline-none"
          />
        </label>
        {send.isError && (
          <p className="text-xs text-destructive">
            {send.error instanceof PublicApiError ? send.error.message : t("L'envoi n'a pas abouti. Réessayez.", "Sending failed. Try again.")}
          </p>
        )}
        <Button type="submit" loading={send.isPending} disabled={!email.trim() || !message.trim()} className="w-full">
          {send.isPending ? t("Envoi...", "Sending...") : t("Envoyer la demande", "Send the request")}
        </Button>
      </form>
    </Dialog>
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
  const t = useT();
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

  // One place only (a new business has just its default one): nothing to choose, so it is chosen.
  // Without this the customer met a list holding a single "Résidence Lagune" and a disabled
  // button until they opened it — the 2026-11-07 journey check stopped there.
  const onlyResourceId = !tableMode && resources.length === 1 ? resources[0]!.id : undefined;
  useEffect(() => {
    if (onlyResourceId && !resourceId) setValue("resourceId", onlyResourceId, { shouldValidate: true });
  }, [onlyResourceId, resourceId, setValue]);

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

  // Nobody to book: the business switched every resource off (the API creates a default one
  // when there was never any). Say so instead of showing a form that can never be sent.
  if (resourcesQuery.isSuccess && resources.length === 0) {
    return (
      <Dialog open onClose={onClose} title={t(`Réserver — ${offer.name}`, `Book — ${offer.name}`)}>
        <DialogCloseButton onClose={onClose} />
        <p className="text-sm text-text-muted">
          {t(
            "Les réservations en ligne ne sont pas ouvertes pour le moment. Contactez directement l'établissement pour prendre rendez-vous.",
            "Online booking is not open at the moment. Contact the business directly to book.",
          )}
        </p>
      </Dialog>
    );
  }

  return (
    <Dialog open onClose={onClose} title={t(`Réserver — ${offer.name}`, `Book — ${offer.name}`)}>
      <DialogCloseButton onClose={onClose} />
      <form onSubmit={handleSubmit((values) => bookMutation.mutate(values))} className="space-y-3 text-sm">
        <div>
          {tableMode ? (
            <label className="flex items-center gap-2 text-sm text-text">
              {t("Nombre de couverts", "Number of guests")}
              <Input
                type="number"
                min="1"
                max="100"
                aria-label={t("Nombre de couverts", "Number of guests")}
                value={partySize}
                onChange={(e) => setPartySize(Math.max(1, Number(e.target.value) || 1))}
                className="w-20"
              />
            </label>
          ) : staffOnly ? (
            // A salon's customer books a person, not an "emplacement": show who they are.
            <div role="radiogroup" aria-label={t("Avec qui ?", "With whom?")} className="space-y-1">
              <p className="text-xs font-medium text-text-muted">{t("Avec qui ?", "With whom?")}</p>
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
          ) : onlyResourceId ? null : (
          <Select
            {...register("resourceId", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
            aria-label={isStay ? t("Logement", "Accommodation") : t("Emplacement", "Place")}
            error={!!errors.resourceId}
            className="w-full"
          >
            <option value="" disabled>
              {isStay ? t("Choisir un logement", "Choose an accommodation") : t("Choisir un emplacement", "Choose a place")}
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
              {t("Impossible de charger les emplacements.", "Places could not be loaded.")}{" "}
              <button type="button" onClick={() => resourcesQuery.refetch()} className="underline">
                {t("Réessayer", "Try again")}
              </button>
            </p>
          )}
          {errors.resourceId && <p className="mt-1 text-xs text-destructive">{errors.resourceId.message}</p>}
        </div>

        {isStay ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <label className="flex-1 text-xs text-text-muted">
                {t("Arrivée", "Arrival")}
                <Input
                  type="date"
                  aria-label={t("Date d'arrivée", "Arrival date")}
                  value={checkIn}
                  min={localToday()}
                  onChange={(e) => setCheckIn(e.target.value)}
                  className="mt-1 w-full"
                />
              </label>
              <label className="flex-1 text-xs text-text-muted">
                {t("Départ", "Departure")}
                <Input
                  type="date"
                  aria-label={t("Date de départ", "Departure date")}
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
                  : (() => {
                      const reason = STAY_UNAVAILABLE_LABELS[stayQuery.data.reason ?? ""];
                      return reason ? t(...reason) : t(
                        "Indisponible à ces dates.",
                        "Unavailable on these dates.",
                      );
                    })()}
              </p>
            )}
            {offer.minNights && offer.minNights > 1 && (
              <p className="text-xs text-text-muted">
              {t(`Séjour minimum : ${offer.minNights} nuits.`, `Minimum stay: ${offer.minNights} nights.`)}
            </p>
            )}
          </div>
        ) : (
          <>
        <div className="flex gap-2">
          <Input
            type="date"
            aria-label={t("Date de réservation", "Booking date")}
            value={date}
            min={localToday()}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1"
          />
          {fixedDuration ? (
            <p className="self-center text-xs text-text-muted">
              {t("Durée :", "Length:")} {formatDuration(fixedDuration)}
            </p>
          ) : (
            <Select
              aria-label={t("Durée", "Length")}
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
            {slotsQuery.isLoading && <p className="text-xs text-text-muted">{t("Chargement des créneaux...", "Loading time slots...")}</p>}
            {slotsQuery.isError && (
              <p className="text-xs text-destructive">
                {t("Impossible de charger les créneaux.", "Time slots could not be loaded.")}{" "}
                <button type="button" onClick={() => slotsQuery.refetch()} className="underline">
                  {t("Réessayer", "Try again")}
                </button>
              </p>
            )}
            {slotsQuery.data &&
              (slotsQuery.data.slots.length ? (
                <div role="group" aria-label={t("Créneaux disponibles", "Available slots")} className="flex flex-wrap gap-2">
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
                <p className="text-xs text-text-muted">{t(
                  "Aucun créneau disponible ce jour-là.",
                  "No slots available that day.",
                )}</p>
              ))}
          </div>
        )}

          </>
        )}

        <Input
          placeholder={t("Prénom", "First name")}
          aria-label={t("Prénom", "First name")}
          {...register("contact.firstName", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
          error={!!errors.contact?.firstName}
        />
        <div>
          <Input
            type="email"
            placeholder={t("E-mail", "E-mail")}
            aria-label={t("Adresse e-mail", "Email address")}
            {...register("contact.email")}
            error={!!errors.contact?.email}
          />
          {errors.contact?.email && (
            <p className="mt-1 text-xs text-destructive">{errors.contact.email.message}</p>
          )}
        </div>
        <Input
          placeholder={t("Téléphone (optionnel)", "Phone (optional)")}
          aria-label={t("Téléphone", "Phone")}
          {...register("contact.phone", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
          error={!!errors.contact?.phone}
        />

        {bookMutation.isError && (
          <p className="text-xs text-destructive">
            {bookMutation.error instanceof PublicApiError ? bookMutation.error.message : t("Erreur", "Error")}
          </p>
        )}
        <Button
          type="submit"
          loading={bookMutation.isPending}
          disabled={isStay ? !stayReady : !startAt}
          className="w-full"
        >
          {bookMutation.isPending ? t("Envoi...", "Sending...") : t("Confirmer la réservation", "Confirm the booking")}
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
  actions,
  onClose,
  onSuccess,
}: {
  slug: string;
  cart: CartLine[];
  /** Change, remove, clear or put aside what is in the basket. Absent: a read-only summary. */
  actions?: CartActions;
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
  const locale = useStorefrontLocale();
  const t = useT();
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
  // Online payment has a floor (MIN_ONLINE_PAYMENT: GeniusPay's fixed fee would eat the sale), and
  // in a shop not priced in CFA francs GeniusPay charges the customer in XOF at its own rate — said
  // here, before the customer lands on a payment page showing another currency.
  const onlineMinimum = minimumOnlinePayment(currency);
  const onlineBelowMinimum = total < onlineMinimum;
  const settlesInXof = !["XOF", "XAF"].includes(currency.toUpperCase());
  const observedXofRate = PROVIDER_OBSERVED_XOF_RATES[currency.toUpperCase()];
  const formatXof = (amount: number) =>
    `${Math.round(amount).toLocaleString(locale === "en" ? "en-GB" : "fr-FR")} F CFA`;

  const {
    register,
    handleSubmit,
    setValue,
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

  // The basket can change while this dialog is open (quantity, removal, a line brought back):
  // the order always carries what the shopper sees, never the basket as it was on opening.
  useEffect(() => {
    setValue(
      "items",
      cart.map((line) => ({
        offerId: line.offerId,
        variantId: line.variantId,
        optionIds: line.optionIds,
        quantity: line.quantity,
      })),
    );
  }, [cart, setValue]);

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
    <Dialog open onClose={onClose} title={t("Finaliser la commande", "Complete the order")}>
      <DialogCloseButton onClose={onClose} />
      <BasketEditor cart={cart} currency={currency} actions={actions} />
      {cart.length > 0 && (
        <form onSubmit={handleSubmit((values) => orderMutation.mutate(values))} className="mt-3 space-y-3 text-sm">
          <div className="space-y-1 text-right text-sm">
            {shippingCost > 0 && (
              <p className="text-text-muted">
                {t("Livraison", "Delivery")} : {shippingCost.toFixed(2)} {currency}
              </p>
            )}
            <p className="font-medium text-text">
              {t("Total", "Total")} : {total.toFixed(2)} {currency}
            </p>
          </div>

          <Input
            placeholder={t("Code promo (optionnel)", "Discount code (optional)")}
            aria-label={t("Code promo", "Discount code")}
            {...register("discountCode")}
          />

          <Input
            placeholder={t("Prénom", "First name")}
            aria-label={t("Prénom", "First name")}
            {...register("contact.firstName", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
            error={!!errors.contact?.firstName}
          />
          <div>
            <Input
              type="email"
              placeholder={t("E-mail", "E-mail")}
              aria-label={t("Adresse e-mail", "Email address")}
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
            placeholder={t("Téléphone (optionnel)", "Phone (optional)")}
            aria-label={t("Téléphone", "Phone")}
            {...register("contact.phone", { setValueAs: (v: string) => (v === "" ? undefined : v) })}
            error={!!errors.contact?.phone}
          />

          {configured && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-medium text-text-muted">{t("Réception", "Receiving")}</p>
              <div role="radiogroup" aria-label={t("Mode de réception", "How you receive it")} className="flex flex-wrap gap-3">
                {modes.map((candidate) => (
                  <label key={candidate} className="flex items-center gap-2 text-sm text-text">
                    <input
                      type="radio"
                      name="fulfillmentMode"
                      value={candidate}
                      checked={mode === candidate}
                      onChange={() => setMode(candidate)}
                    />
                    {(locale === "en" ? FULFILLMENT_MODE_LABELS_EN : FULFILLMENT_MODE_LABELS)[candidate]}
                  </label>
                ))}
              </div>

              {mode === "delivery" && zones.length > 0 && (
                <Select
                  aria-label={t("Zone de livraison", "Delivery zone")}
                  value={zoneId}
                  onChange={(e) => setZoneId(e.target.value)}
                  className="w-full"
                >
                  <option value="">{t("Choisir votre zone", "Choose your zone")}</option>
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
                  {t(
                    `Commande minimum pour ${zone.name} : ${zone.minimumOrder.toFixed(2)} ${currency}.`,
                    `Minimum order for ${zone.name}: ${zone.minimumOrder.toFixed(2)} ${currency}.`,
                  )}
                </p>
              )}

              {mode === "pickup" && reception?.pickupInstructions && (
                <p className="text-xs text-text-muted">{reception.pickupInstructions}</p>
              )}

              {mode === "dine_in" && (
                <Input
                  placeholder={t("Table (optionnel)", "Table (optional)")}
                  aria-label={t("Table", "Table")}
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
                  {t("Dès que possible", "As soon as possible")}
                </label>
                <label className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="radio"
                    name="when"
                    checked={when === "later"}
                    onChange={() => setWhen("later")}
                  />
                  {t("Choisir une heure", "Choose a time")}
                </label>
              </div>
              {when === "later" && (
                <div className="flex gap-2">
                  <Input
                    type="date"
                    aria-label={t("Date souhaitée", "Preferred date")}
                    value={requestedDate}
                    min={localToday()}
                    onChange={(e) => setRequestedDate(e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    type="time"
                    aria-label={t("Heure souhaitée", "Preferred time")}
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
              {configured ? t("Adresse de livraison", "Delivery address") : t("Adresse de livraison (optionnel)", "Delivery address (optional)")}
            </p>
            <Input
              placeholder={t("Adresse", "Address")}
              aria-label={t("Adresse", "Address")}
              {...register("shippingAddress.line1")}
            />
            <Input
              placeholder={t("Complément d'adresse", "Address line 2")}
              aria-label={t("Complément d'adresse", "Address line 2")}
              {...register("shippingAddress.line2")}
            />
            <div className="flex gap-2">
              <Input
                placeholder={t("Ville", "Town")}
                aria-label={t("Ville", "Town")}
                className="flex-1"
                {...register("shippingAddress.city")}
              />
              <Input
                placeholder={t("Code postal", "Postcode")}
                aria-label={t("Code postal", "Postcode")}
                className="w-28"
                {...register("shippingAddress.postalCode")}
              />
            </div>
            <Input
              placeholder={t("Pays", "Country")}
              aria-label={t("Pays", "Country")}
              {...register("shippingAddress.country")}
            />
          </div>
          )}

          {acceptedPaymentMethods.length > 1 && (
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-xs font-medium text-text-muted">{t("Mode de paiement", "Payment method")}</p>
              {acceptedPaymentMethods.map((method) => (
                <label key={method} className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value={method}
                    checked={paymentMethod === method}
                    disabled={method === "online" && onlineBelowMinimum}
                    onChange={() => setPaymentMethod(method)}
                  />
                  {t(...PAYMENT_METHOD_LABELS[method])}
                </label>
              ))}
            </div>
          )}

          {paymentMethod === "online" && onlineBelowMinimum && (
            <p className="text-xs text-destructive">
              {t(
                `Le paiement en ligne commence à ${onlineMinimum} ${currency}. Ajoutez un article${acceptedPaymentMethods.length > 1 ? " ou choisissez un autre mode de paiement" : ""}.`,
                `Online payment starts at ${onlineMinimum} ${currency}. Add an item${acceptedPaymentMethods.length > 1 ? " or choose another payment method" : ""}.`,
              )}
            </p>
          )}
          {paymentMethod === "online" && settlesInXof && !onlineBelowMinimum && (
            <p className="rounded-md bg-surface-muted px-3 py-2 text-xs text-text-muted">
              {observedXofRate
                ? t(
                    `Le paiement en ligne se fait en francs CFA : vous paierez environ ${formatXof(total * observedXofRate)} pour ${total.toFixed(2)} ${currency}, au taux de change de GeniusPay.`,
                    `Online payment is made in CFA francs: you will pay about ${formatXof(total * observedXofRate)} for ${total.toFixed(2)} ${currency}, at GeniusPay's exchange rate.`,
                  )
                : t(
                    `Le paiement en ligne se fait en francs CFA, au taux de change de GeniusPay : le montant exact s'affiche sur la page de paiement.`,
                    `Online payment is made in CFA francs at GeniusPay's exchange rate: the exact amount shows on the payment page.`,
                  )}
            </p>
          )}

          {errors.items && <p className="text-xs text-destructive">{errors.items.message ?? t("Panier invalide.", "The basket is not valid.")}</p>}
          {orderMutation.isError && (
            <p className="text-xs text-destructive">
              {orderMutation.error instanceof PublicApiError ? orderMutation.error.message : t("Erreur", "Error")}
            </p>
          )}
          {payMutation.isError && (
            <p className="text-xs text-destructive">
              {payMutation.error instanceof PublicApiError
                ? payMutation.error.message
                : t("Impossible de démarrer le paiement en ligne.", "Online payment could not be started.")}
            </p>
          )}
          <Button
            type="submit"
            loading={orderMutation.isPending || payMutation.isPending || redirecting}
            disabled={
              cart.length === 0 ||
              belowMinimum ||
              (paymentMethod === "online" && onlineBelowMinimum) ||
              needsZone ||
              (configured && when === "later" && !requestedTime)
            }
            className="w-full"
          >
            {redirecting
              ? t("Redirection vers le paiement...", "Taking you to payment...")
              : orderMutation.isPending || payMutation.isPending
                ? t("Envoi...", "Sending...")
                : paymentMethod === "online"
                  ? t("Payer par mobile money ou carte", "Pay by mobile money or card")
                  : t("Confirmer la commande", "Confirm the order")}
          </Button>
        </form>
      )}
    </Dialog>
  );
}

/**
 * The basket itself: change a quantity, remove a line, empty it, or put lines aside for later
 * (the shopper's "brouillon" — kept in this browser, never ordered until brought back).
 */
function BasketEditor({
  cart,
  currency,
  actions,
}: {
  cart: CartLine[];
  currency: string;
  actions?: CartActions;
}) {
  const t = useT();
  const [confirmClear, setConfirmClear] = useState(false);
  const saved = actions?.saved ?? [];
  const smallButton =
    "inline-flex min-h-9 items-center rounded-md px-2 text-xs font-medium text-text-muted hover:bg-surface-muted hover:text-text";

  return (
    <div className="space-y-3 text-sm">
      {cart.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-text-muted">
          {saved.length > 0
            ? t("Votre panier est vide. Vos articles mis de côté sont ci-dessous.", "Your basket is empty. The items you put aside are below.")
            : t("Votre panier est vide.", "Your basket is empty.")}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border" aria-label={t("Panier", "Basket")}>
          {cart.map((line) => {
            const key = lineKey(line);
            return (
              <li key={key} className="space-y-1.5 px-3 py-2">
                <div className="flex justify-between gap-3">
                  <span className="text-text">{line.name}</span>
                  <span className="shrink-0 font-medium text-text">
                    {(line.unitPrice * line.quantity).toFixed(2)} {currency}
                  </span>
                </div>
                {actions ? (
                  <div className="flex flex-wrap items-center gap-1">
                    <div className="inline-flex items-center rounded-md border border-border">
                      <button
                        type="button"
                        className="h-9 w-9 text-base text-text hover:bg-surface-muted"
                        aria-label={t(`Retirer un ${line.name}`, `One less ${line.name}`)}
                        onClick={() => actions.setQuantity(key, line.quantity - 1)}
                      >
                        −
                      </button>
                      <span className="min-w-8 text-center tabular-nums" aria-label={t("Quantité", "Quantity")}>
                        {line.quantity}
                      </span>
                      <button
                        type="button"
                        className="h-9 w-9 text-base text-text hover:bg-surface-muted disabled:opacity-40"
                        aria-label={t(`Ajouter un ${line.name}`, `One more ${line.name}`)}
                        disabled={line.quantity >= MAX_LINE_QUANTITY}
                        onClick={() => actions.setQuantity(key, line.quantity + 1)}
                      >
                        +
                      </button>
                    </div>
                    <button type="button" className={smallButton} onClick={() => actions.saveForLater(key)}>
                      {t("Mettre de côté", "Save for later")}
                    </button>
                    <button type="button" className={smallButton} onClick={() => actions.removeLine(key)}>
                      {t("Supprimer", "Remove")}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">× {line.quantity}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {actions && cart.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          <button type="button" className={smallButton} onClick={actions.saveAllForLater}>
            {t("Tout mettre de côté", "Save everything for later")}
          </button>
          {confirmClear ? (
            <>
              <button
                type="button"
                className={`${smallButton} text-destructive`}
                onClick={() => {
                  actions.clearCart();
                  setConfirmClear(false);
                }}
              >
                {t("Oui, vider le panier", "Yes, empty the basket")}
              </button>
              <button type="button" className={smallButton} onClick={() => setConfirmClear(false)}>
                {t("Annuler", "Cancel")}
              </button>
            </>
          ) : (
            <button type="button" className={smallButton} onClick={() => setConfirmClear(true)}>
              {t("Vider le panier", "Empty the basket")}
            </button>
          )}
        </div>
      )}

      {saved.length > 0 && actions && (
        <section className="space-y-2 border-t border-border pt-3" aria-label={t("Mis de côté", "Saved for later")}>
          <p className="text-xs font-medium text-text-muted">
            {t(`Mis de côté (${saved.length})`, `Saved for later (${saved.length})`)}
          </p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {saved.map((line) => {
              const key = lineKey(line);
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="text-text">
                    {line.name} × {line.quantity}
                  </span>
                  <span className="flex gap-1">
                    <button type="button" className={smallButton} onClick={() => actions.restoreSaved(key)}>
                      {t("Remettre dans le panier", "Move to basket")}
                    </button>
                    <button type="button" className={smallButton} onClick={() => actions.removeSaved(key)}>
                      {t("Supprimer", "Remove")}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
