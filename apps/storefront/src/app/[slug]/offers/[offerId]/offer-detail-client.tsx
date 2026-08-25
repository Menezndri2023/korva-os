"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card } from "@korva/ui";
import { publicApiClient } from "@/lib/public-api-client";
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
  // Same query key as the catalog page's offersQuery — reuses its cache when navigating from
  // there, and fetches fresh on a direct link. See page.tsx for the "no single-offer endpoint,
  // capped at 50 items" limitation this lookup-by-id inherits.
  const offersQuery = useQuery({
    queryKey: ["public-offers", slug],
    queryFn: () => publicApiClient.get<PublicOffer[]>(`/public/${slug}/offers`),
    enabled: !!orgQuery.data?.enabledModules.includes("catalog"),
  });

  const { cart, addToCart, clearCart } = useCart(slug);
  const [showBooking, setShowBooking] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  if (orgQuery.isLoading || (orgQuery.data && offersQuery.isLoading)) {
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

  if (offersQuery.isError) {
    return (
      <CenteredMessage>
        <p>Impossible de charger cette offre.</p>
        <button onClick={() => offersQuery.refetch()} className="mt-2 text-sm font-medium underline">
          Réessayer
        </button>
      </CenteredMessage>
    );
  }

  const offer = offersQuery.data?.find((o) => o.id === offerId);
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
                <Button onClick={() => addToCart(offer)}>Ajouter au panier</Button>
              )}
            </div>

            {offer.variants.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-medium text-text">Variantes</h3>
                <Card className="mt-2 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium uppercase text-text-muted">
                      <tr>
                        <th className="px-3 py-2">Variante</th>
                        <th className="px-3 py-2">SKU</th>
                        <th className="px-3 py-2">Prix</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {offer.variants.map((variant) => (
                        <tr key={variant.id}>
                          <td className="px-3 py-2 font-medium text-text">{variant.name}</td>
                          <td className="px-3 py-2 text-text-muted">{variant.sku ?? "—"}</td>
                          <td className="px-3 py-2 text-text-muted">
                            {variant.priceOverride != null
                              ? formatOfferPrice(variant.priceOverride, offer.pricing.currency)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
          onClose={() => setShowCheckout(false)}
          onSuccess={(orderNumber) => {
            clearCart();
            setShowCheckout(false);
            setConfirmation(`Commande ${orderNumber} confirmée, merci !`);
            void queryClient.invalidateQueries({ queryKey: ["public-offers", slug] });
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
