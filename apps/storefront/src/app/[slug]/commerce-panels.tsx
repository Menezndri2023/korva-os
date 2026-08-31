"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createPublicBookingSchema,
  createPublicOrderSchema,
  type CreatePublicBookingInput,
  type CreatePublicOrderInput,
} from "@korva/validation";
import { Button, Dialog, Input, Select } from "@korva/ui";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";
import type { CartLine, PublicAvailability, PublicOffer, PublicResource } from "@/lib/public-types";

const DURATIONS = [
  { label: "30 min", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "1h30", minutes: 90 },
  { label: "2h", minutes: 120 },
];

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
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
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
  const resourceId = watch("resourceId");

  // startAt/endAt are the fields the backend actually validates (createPublicBookingSchema
  // requires full ISO datetimes) — derived here from the friendlier date/time/duration pickers
  // and kept in sync so handleSubmit validates against the exact same schema the API enforces.
  useEffect(() => {
    if (!startTime) return;
    const startAtDate = new Date(`${date}T${startTime}:00.000Z`);
    const endAtDate = new Date(startAtDate.getTime() + durationMinutes * 60_000);
    setValue("startAt", startAtDate.toISOString());
    setValue("endAt", endAtDate.toISOString());
  }, [date, startTime, durationMinutes, setValue]);

  const resourcesQuery = useQuery({
    queryKey: ["public-resources", slug],
    queryFn: () => publicApiClient.get<PublicResource[]>(`/public/${slug}/resources`),
  });
  const availabilityQuery = useQuery({
    queryKey: ["public-availability", slug, resourceId, date],
    queryFn: () =>
      publicApiClient.get<PublicAvailability>(
        `/public/${slug}/availability?resourceId=${resourceId}&date=${date}`,
      ),
    enabled: !!resourceId,
  });

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

        <Input
          type="date"
          aria-label="Date de réservation"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full"
        />

        {resourceId && (
          <div className="text-xs text-text-muted">
            {availabilityQuery.isLoading && <p>Chargement des créneaux...</p>}
            {availabilityQuery.isError && (
              <p className="text-destructive">
                Impossible de charger les disponibilités.{" "}
                <button type="button" onClick={() => availabilityQuery.refetch()} className="underline">
                  Réessayer
                </button>
              </p>
            )}
            {availabilityQuery.data &&
              (availabilityQuery.data.windows.length ? (
                <p>
                  Horaires :{" "}
                  {availabilityQuery.data.windows.map((w) => `${w.startTime}–${w.endTime}`).join(", ")}
                </p>
              ) : (
                <p>Aucun créneau ce jour-là.</p>
              ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            type="time"
            aria-label="Heure de début"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="flex-1"
          />
          <Select
            aria-label="Durée"
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
          >
            {DURATIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>
                {d.label}
              </option>
            ))}
          </Select>
        </div>

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
        <Button type="submit" loading={bookMutation.isPending} disabled={!startTime} className="w-full">
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
  onClose,
  onSuccess,
}: {
  slug: string;
  cart: CartLine[];
  currency: string;
  shippingFlatRate?: number;
  onClose: () => void;
  onSuccess: (orderNumber: string) => void;
}) {
  const itemsTotal = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const shippingCost = shippingFlatRate ?? 0;
  const total = itemsTotal + shippingCost;

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
      contact: { email: "", firstName: "", phone: "" },
      discountCode: "",
      shippingAddress: { line1: "", line2: "", city: "", postalCode: "", country: "" },
    },
  });

  const orderMutation = useMutation({
    mutationFn: (values: CreatePublicOrderInput) =>
      publicApiClient.post<{ number: string }>(`/public/${slug}/orders`, {
        ...values,
        contact: {
          email: values.contact.email,
          firstName: values.contact.firstName || undefined,
          phone: values.contact.phone || undefined,
        },
        discountCode: values.discountCode || undefined,
        shippingAddress: values.shippingAddress,
      }),
    onSuccess: (order) => onSuccess(order.number),
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

        {errors.items && <p className="text-xs text-destructive">{errors.items.message ?? "Panier invalide."}</p>}
        {orderMutation.isError && (
          <p className="text-xs text-destructive">
            {orderMutation.error instanceof PublicApiError ? orderMutation.error.message : "Erreur"}
          </p>
        )}
        <Button type="submit" loading={orderMutation.isPending} disabled={cart.length === 0} className="w-full">
          {orderMutation.isPending ? "Envoi..." : "Confirmer la commande"}
        </Button>
      </form>
    </Dialog>
  );
}
