"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card } from "@korva/ui";
import { PublicApiError, publicApiClient } from "@/lib/public-api-client";
import { useCart } from "@/lib/use-cart";
import { OFFER_TYPE_LABELS, formatOfferPrice } from "@/lib/offer-labels";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { BookingPanel, CheckoutPanel } from "../../commerce-panels";

export default function OfferDetailClient({ slug, offerId }: { slug: string; offerId: string }) {
  const queryClient = useQueryClient();

  const orgQuery = useQuery({
    queryKey: ["public-org", slug],
    queryFn: () => publicApiClient.get<PublicOrganization>(`/public/${slug}`),
    retry: false,
  });
  // A dedicated single-offer lookup (not a client-side .find() over the homepage's capped
  // 50-item preview list) — an offer beyond that cap must still have a working detail page.
  const offerQuery = useQuery({
    queryKey: ["public-offer", slug, offerId],
    queryFn: () => publicApiClient.get<PublicOffer>(`/public/${slug}/offers/${offerId}`),
    enabled: !!orgQuery.data?.enabledModules.includes("catalog"),
    retry: false,
  });

  const { cart, addToCart, clearCart } = useCart(slug);
  const [showBooking, setShowBooking] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState("");

  if (orgQuery.isLoading || (orgQuery.data && offerQuery.isLoading)) {
    return <DetailSkeleton slug={slug} />;
  }
  if (orgQuery.isError || !orgQuery.data) {
    return (
      <CenteredMessage>
        <p>Cette boutique n&apos;existe pas.</p>
        <button onClick={() => orgQuery.refetch()} className="mt-2 text-sm font-medium underline">
          Réessayer
        </button>
      </CenteredMessage>
    );
  }
  const organization = orgQuery.data;

  if (!organization.enabledModules.includes("catalog")) {
    return (
      <CenteredMessage>
        <p>Aucun catalogue disponible pour cette boutique.</p>
        <BackLink slug={slug} />
      </CenteredMessage>
    );
  }

  if (offerQuery.isError) {
    const isNotFound =
      offerQuery.error instanceof PublicApiError && offerQuery.error.code === "OFFER_NOT_FOUND";
    if (isNotFound) {
      return (
        <CenteredMessage>
          <p>Cette offre n&apos;existe pas ou n&apos;est plus disponible.</p>
          <BackLink slug={slug} />
        </CenteredMessage>
      );
    }
    return (
      <CenteredMessage>
        <p>Impossible de charger cette offre.</p>
        <button onClick={() => offerQuery.refetch()} className="mt-2 text-sm font-medium underline">
          Réessayer
        </button>
      </CenteredMessage>
    );
  }

  const offer = offerQuery.data;
  if (!offer) {
    return (
      <CenteredMessage>
        <p>Cette offre n&apos;existe pas ou n&apos;est plus disponible.</p>
        <BackLink slug={slug} />
      </CenteredMessage>
    );
  }

  const bookingEnabled = organization.enabledModules.includes("booking");
  const commerceEnabled = organization.enabledModules.includes("commerce");
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const images = offer.images;
  const selectedVariant =
    offer.variants.find((v) => v.id === selectedVariantId) ?? offer.variants[0];

  return (
    <div className="min-h-screen bg-app-background">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <h1 className="text-lg font-semibold text-text">{organization.name}</h1>
          {commerceEnabled && cartCount > 0 && (
            <Button size="sm" onClick={() => setShowCheckout(true)}>
              Panier ({cartCount})
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        <BackLink slug={slug} />

        {confirmation && (
          <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800">
            {confirmation}
          </div>
        )}

        <Card className="overflow-hidden p-6 sm:flex sm:gap-6">
          <div className="sm:w-64 sm:flex-shrink-0">
            {images.length > 0 && !imageFailed ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary tenant-supplied
                    host, not one of Next's configured image domains (see middleware.ts img-src). */}
                <img
                  src={images[activeImage]}
                  alt={offer.name}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setImageFailed(true)}
                  className="h-56 w-full rounded-md object-cover"
                />
                {images.length > 1 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {images.map((image, index) => (
                      <button
                        key={image + String(index)}
                        onClick={() => setActiveImage(index)}
                        aria-label={`Image ${index + 1} sur ${images.length}`}
                        aria-current={index === activeImage}
                        className={`h-12 w-12 flex-shrink-0 overflow-hidden rounded border ${
                          index === activeImage ? "border-focus" : "border-border"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                        <img src={image} alt="" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex h-56 w-full items-center justify-center rounded-md bg-surface-muted text-sm text-text-muted">
                Aucune image
              </div>
            )}
          </div>

          <div className="mt-4 flex-1 sm:mt-0">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-xl font-semibold text-text">{offer.name}</h2>
              <Badge>{OFFER_TYPE_LABELS[offer.type]}</Badge>
            </div>

            {offer.categories.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {offer.categories.map((category) => (
                  <Badge key={category} variant="default">
                    {category}
                  </Badge>
                ))}
              </div>
            )}

            <p className="mt-3 text-lg font-medium text-text">
              {formatOfferPrice(offer.pricing.amount, offer.pricing.currency)}
              {offer.pricing.taxRate != null && (
                <span className="ml-1 text-sm font-normal text-text-muted">
                  (TVA {offer.pricing.taxRate}%)
                </span>
              )}
            </p>

            {offer.description && <p className="mt-3 text-sm text-text-muted">{offer.description}</p>}

            <div className="mt-4 flex gap-2">
              {offer.type === "booking" && bookingEnabled && (
                <Button onClick={() => setShowBooking(true)}>Réserver</Button>
              )}
              {offer.type !== "booking" && commerceEnabled && (
                <Button onClick={() => addToCart(offer, selectedVariant)}>
                  Ajouter au panier
                </Button>
              )}
            </div>

            {offer.variants.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-medium text-text">Variantes</h3>
                <Card className="mt-2 overflow-hidden">
                  {/* Separate scroll container from Card's own overflow-hidden (which exists only
                      to clip content to the rounded corners, per packages/ui/src/card/card.tsx) —
                      without it, a variant/SKU too wide for the viewport would be silently cut off
                      on narrow screens instead of reachable via horizontal scroll. */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
                        <tr>
                          {commerceEnabled && offer.type !== "booking" && (
                            <th className="px-3 py-2" aria-hidden />
                          )}
                          <th className="px-3 py-2">Variante</th>
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2">Prix</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {offer.variants.map((variant, index) => (
                          <tr key={variant.id}>
                            {commerceEnabled && offer.type !== "booking" && (
                              <td className="px-3 py-2">
                                <input
                                  type="radio"
                                  name="variant"
                                  aria-label={`Choisir ${variant.name}`}
                                  checked={
                                    selectedVariantId
                                      ? selectedVariantId === variant.id
                                      : index === 0
                                  }
                                  onChange={() => setSelectedVariantId(variant.id)}
                                />
                              </td>
                            )}
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-text">
                              {variant.name}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-text-muted">
                              {variant.sku ?? "—"}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-text-muted">
                              {variant.priceOverride != null
                                ? formatOfferPrice(variant.priceOverride, offer.pricing.currency)
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}
          </div>
        </Card>
      </main>

      {showBooking && (
        <BookingPanel
          slug={slug}
          offer={offer}
          onClose={() => setShowBooking(false)}
          onSuccess={() => {
            setShowBooking(false);
            setConfirmation("Votre réservation a bien été enregistrée.");
          }}
        />
      )}

      {showCheckout && (
        <CheckoutPanel
          slug={slug}
          cart={cart}
          currency={organization.currency}
          shippingFlatRate={organization.shippingFlatRate}
          acceptedPaymentMethods={organization.acceptedPaymentMethods}
          onClose={() => setShowCheckout(false)}
          onSuccess={(orderNumber) => {
            clearCart();
            setShowCheckout(false);
            setConfirmation(`Commande ${orderNumber} confirmée, merci !`);
            void queryClient.invalidateQueries({ queryKey: ["public-offers", slug] });
            void queryClient.invalidateQueries({ queryKey: ["public-offer", slug, offerId] });
          }}
        />
      )}
    </div>
  );
}

function BackLink({ slug }: { slug: string }) {
  return (
    <Link href={`/${slug}`} className="text-sm text-text-muted hover:underline">
      ← Retour à la boutique
    </Link>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-1 bg-app-background text-sm text-text-muted">
      {children}
    </div>
  );
}

function DetailSkeleton({ slug }: { slug: string }) {
  return (
    <div className="min-h-screen bg-app-background">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto max-w-4xl">
          <div className="h-5 w-40 animate-pulse rounded bg-surface-muted" />
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        <BackLink slug={slug} />
        <Card className="overflow-hidden p-6 sm:flex sm:gap-6">
          <div className="h-56 w-full animate-pulse rounded-md bg-surface-muted sm:w-64" />
          <div className="mt-4 flex-1 space-y-3 sm:mt-0">
            <div className="h-6 w-2/3 animate-pulse rounded bg-surface-muted" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-surface-muted" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-surface-muted" />
          </div>
        </Card>
      </main>
    </div>
  );
}
