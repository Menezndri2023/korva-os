"use client";

import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { publicApiClient, PublicApiError } from "@/lib/public-api-client";

interface PublicOrganization {
  name: string;
  slug: string;
  type: string;
  currency: string;
  language: string;
  logo?: string;
  enabledModules: string[];
}
interface PublicOfferPricing {
  amount: number;
  currency: string;
  taxRate?: number;
}
interface PublicOffer {
  id: string;
  type: string;
  name: string;
  description?: string;
  images: string[];
  categories: string[];
  pricing: PublicOfferPricing;
}
interface PublicResource {
  id: string;
  name: string;
  type: string;
  capacity?: number;
}
interface PublicAvailability {
  date: string;
  windows: { startTime: string; endTime: string }[];
  bookings: { startAt: string; endAt: string }[];
}
interface CartLine {
  offerId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}
interface ContactFormValues {
  firstName: string;
  email: string;
  phone: string;
}

const DURATIONS = [
  { label: "30 min", minutes: 30 },
  { label: "1h", minutes: 60 },
  { label: "1h30", minutes: 90 },
  { label: "2h", minutes: 120 },
];

export default function StorefrontPage() {
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();

  const orgQuery = useQuery({
    queryKey: ["public-org", slug],
    queryFn: () => publicApiClient.get<PublicOrganization>(`/public/${slug}`),
    retry: false,
  });
  const offersQuery = useQuery({
    queryKey: ["public-offers", slug],
    queryFn: () => publicApiClient.get<PublicOffer[]>(`/public/${slug}/offers`),
    enabled: !!orgQuery.data?.enabledModules.includes("catalog"),
  });

  const [cart, setCart] = useState<CartLine[]>([]);
  const [bookingOffer, setBookingOffer] = useState<PublicOffer | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  if (orgQuery.isLoading) {
    return <CenteredMessage>Chargement...</CenteredMessage>;
  }
  if (orgQuery.isError || !orgQuery.data) {
    return <CenteredMessage>Cette boutique n&apos;existe pas.</CenteredMessage>;
  }
  const organization = orgQuery.data;
  const bookingEnabled = organization.enabledModules.includes("booking");
  const commerceEnabled = organization.enabledModules.includes("commerce");
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  function addToCart(offer: PublicOffer) {
    setCart((prev) => {
      const existing = prev.find((line) => line.offerId === offer.id);
      if (existing) {
        return prev.map((line) =>
          line.offerId === offer.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      }
      return [...prev, { offerId: offer.id, name: offer.name, unitPrice: offer.pricing.amount, quantity: 1 }];
    });
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <h1 className="text-lg font-semibold text-zinc-900">{organization.name}</h1>
          {commerceEnabled && cartCount > 0 && (
            <button
              onClick={() => setShowCheckout(true)}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Panier ({cartCount})
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        {confirmation && (
          <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800">
            {confirmation}
          </div>
        )}

        {!organization.enabledModules.includes("catalog") && (
          <p className="text-sm text-zinc-500">Aucun catalogue disponible pour le moment.</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {offersQuery.data?.map((offer) => (
            <div key={offer.id} className="rounded-lg border border-zinc-200 bg-white p-4">
              <p className="font-medium text-zinc-900">{offer.name}</p>
              {offer.description && (
                <p className="mt-1 text-sm text-zinc-500">{offer.description}</p>
              )}
              <p className="mt-2 text-sm font-medium text-zinc-700">
                {offer.pricing.amount} {offer.pricing.currency}
              </p>
              <div className="mt-3">
                {offer.type === "booking" && bookingEnabled && (
                  <button
                    onClick={() => setBookingOffer(offer)}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    Réserver
                  </button>
                )}
                {offer.type !== "booking" && commerceEnabled && (
                  <button
                    onClick={() => addToCart(offer)}
                    className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    Ajouter au panier
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </main>

      {bookingOffer && (
        <BookingPanel
          slug={slug}
          offer={bookingOffer}
          onClose={() => setBookingOffer(null)}
          onSuccess={() => {
            setBookingOffer(null);
            setConfirmation("Votre réservation a bien été enregistrée.");
          }}
        />
      )}

      {showCheckout && (
        <CheckoutPanel
          slug={slug}
          cart={cart}
          currency={organization.currency}
          onClose={() => setShowCheckout(false)}
          onSuccess={(orderNumber) => {
            setCart([]);
            setShowCheckout(false);
            setConfirmation(`Commande ${orderNumber} confirmée, merci !`);
            void queryClient.invalidateQueries({ queryKey: ["public-offers", slug] });
          }}
        />
      )}
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm text-zinc-500">
      {children}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <button onClick={onClose} className="text-sm text-zinc-400 hover:text-zinc-600">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BookingPanel({
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
  const [resourceId, setResourceId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [contact, setContact] = useState<ContactFormValues>({ firstName: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);

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
    mutationFn: () => {
      const startAt = new Date(`${date}T${startTime}:00.000Z`);
      const endAt = new Date(startAt.getTime() + durationMinutes * 60_000);
      return publicApiClient.post(`/public/${slug}/bookings`, {
        resourceId,
        offerId: offer.id,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        contact: {
          email: contact.email,
          firstName: contact.firstName || undefined,
          phone: contact.phone || undefined,
        },
      });
    },
    onSuccess,
    onError: (err) => setError(err instanceof PublicApiError ? err.message : "Erreur"),
  });

  return (
    <Modal title={`Réserver — ${offer.name}`} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <select
          value={resourceId}
          onChange={(e) => setResourceId(e.target.value)}
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5"
        >
          <option value="" disabled>
            Choisir un emplacement
          </option>
          {resourcesQuery.data?.map((resource) => (
            <option key={resource.id} value={resource.id}>
              {resource.name}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5"
        />

        {resourceId && (
          <div className="text-xs text-zinc-500">
            {availabilityQuery.data?.windows.length ? (
              <p>
                Horaires :{" "}
                {availabilityQuery.data.windows
                  .map((w) => `${w.startTime}–${w.endTime}`)
                  .join(", ")}
              </p>
            ) : (
              <p>Aucun créneau ce jour-là.</p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="flex-1 rounded-md border border-zinc-300 px-2 py-1.5"
          />
          <select
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className="rounded-md border border-zinc-300 px-2 py-1.5"
          >
            {DURATIONS.map((d) => (
              <option key={d.minutes} value={d.minutes}>
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <input
          placeholder="Prénom"
          value={contact.firstName}
          onChange={(e) => setContact({ ...contact, firstName: e.target.value })}
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5"
        />
        <input
          type="email"
          placeholder="E-mail"
          value={contact.email}
          onChange={(e) => setContact({ ...contact, email: e.target.value })}
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5"
        />
        <input
          placeholder="Téléphone (optionnel)"
          value={contact.phone}
          onChange={(e) => setContact({ ...contact, phone: e.target.value })}
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5"
        />

        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={() => bookMutation.mutate()}
          disabled={!resourceId || !startTime || !contact.email || bookMutation.isPending}
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {bookMutation.isPending ? "Envoi..." : "Confirmer la réservation"}
        </button>
      </div>
    </Modal>
  );
}

function CheckoutPanel({
  slug,
  cart,
  currency,
  onClose,
  onSuccess,
}: {
  slug: string;
  cart: CartLine[];
  currency: string;
  onClose: () => void;
  onSuccess: (orderNumber: string) => void;
}) {
  const [contact, setContact] = useState<ContactFormValues>({ firstName: "", email: "", phone: "" });
  const [error, setError] = useState<string | null>(null);
  const total = cart.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);

  const orderMutation = useMutation({
    mutationFn: () =>
      publicApiClient.post<{ number: string }>(`/public/${slug}/orders`, {
        items: cart.map((line) => ({ offerId: line.offerId, quantity: line.quantity })),
        currency,
        contact: {
          email: contact.email,
          firstName: contact.firstName || undefined,
          phone: contact.phone || undefined,
        },
      }),
    onSuccess: (order) => onSuccess(order.number),
    onError: (err) => setError(err instanceof PublicApiError ? err.message : "Erreur"),
  });

  return (
    <Modal title="Finaliser la commande" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
          {cart.map((line) => (
            <li key={line.offerId} className="flex justify-between px-3 py-2">
              <span>
                {line.name} × {line.quantity}
              </span>
              <span>
                {(line.unitPrice * line.quantity).toFixed(2)} {currency}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-right text-sm font-medium">
          Total : {total.toFixed(2)} {currency}
        </p>

        <input
          placeholder="Prénom"
          value={contact.firstName}
          onChange={(e) => setContact({ ...contact, firstName: e.target.value })}
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5"
        />
        <input
          type="email"
          placeholder="E-mail"
          value={contact.email}
          onChange={(e) => setContact({ ...contact, email: e.target.value })}
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5"
        />
        <input
          placeholder="Téléphone (optionnel)"
          value={contact.phone}
          onChange={(e) => setContact({ ...contact, phone: e.target.value })}
          className="w-full rounded-md border border-zinc-300 px-2 py-1.5"
        />

        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          onClick={() => orderMutation.mutate()}
          disabled={!contact.email || cart.length === 0 || orderMutation.isPending}
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {orderMutation.isPending ? "Envoi..." : "Confirmer la commande"}
        </button>
      </div>
    </Modal>
  );
}
