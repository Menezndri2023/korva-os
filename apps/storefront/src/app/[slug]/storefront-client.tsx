"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Card } from "@korva/ui";
import { publicApiClient } from "@/lib/public-api-client";
import { useCart } from "@/lib/use-cart";
import { OFFER_TYPE_LABELS, formatOfferPrice } from "@/lib/offer-labels";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { BookingPanel, CheckoutPanel } from "./commerce-panels";

export default function StorefrontClient({ slug }: { slug: string }) {
  const queryClient = useQueryClient();

  const orgQuery = useQuery({
    queryKey: ["public-org", slug],
    queryFn: () => publicApiClient.get<PublicOrganization>(`/public/${slug}`),
    retry: false,
  });
  const offersQuery = useQuery({
    queryKey: ["public-offers", slug],
    queryFn: () => publicApiClient.get<PublicOffer[]>(`/public/${slug}/offers`),
    enabled: !!orgQuery.data?.visibleSections.includes("catalog"),
  });

  const { cart, addToCart, clearCart } = useCart(slug);
  const [bookingOffer, setBookingOffer] = useState<PublicOffer | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  if (orgQuery.isLoading) {
    return <StorefrontSkeleton />;
  }
  if (orgQuery.isError || !orgQuery.data) {
    return (
      <CenteredMessage>
        <p>Cette boutique n&apos;existe pas.</p>
        <button
          onClick={() => orgQuery.refetch()}
          className="mt-2 text-sm font-medium text-zinc-900 underline"
        >
          Réessayer
        </button>
      </CenteredMessage>
    );
  }
  const organization = orgQuery.data;
  const catalogVisible = organization.visibleSections.includes("catalog");
  const bookingEnabled = organization.visibleSections.includes("booking");
  const commerceEnabled = organization.enabledModules.includes("commerce");
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const brandColor = organization.brandColor;

  return (
    <div className="min-h-screen bg-app-background">
      <header
        className="border-b border-border bg-surface px-6 py-4"
        style={brandColor ? { borderBottomColor: brandColor, borderBottomWidth: 3 } : undefined}
      >
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <OrganizationLogo organization={organization} />
            <h1 className="text-lg font-semibold text-text">{organization.name}</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/${slug}/track`}
              className="text-sm text-text-muted hover:underline"
            >
              Suivre ma commande
            </Link>
            {commerceEnabled && cartCount > 0 && (
              <Button
                size="sm"
                onClick={() => setShowCheckout(true)}
                style={brandColor ? { backgroundColor: brandColor } : undefined}
              >
                Panier ({cartCount})
              </Button>
            )}
          </div>
        </div>
      </header>

      {(organization.heroImage || organization.tagline) && (
        <HeroSection organization={organization} />
      )}

      <main className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        {confirmation && (
          <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800">
            {confirmation}
          </div>
        )}

        {!catalogVisible && (
          <p className="text-sm text-text-muted">Aucun catalogue disponible pour le moment.</p>
        )}

        {catalogVisible && offersQuery.isLoading && <OffersSkeleton />}

        {catalogVisible && offersQuery.isError && (
          <Card className="p-4 text-sm text-destructive">
            Impossible de charger les offres.{" "}
            <button onClick={() => offersQuery.refetch()} className="underline">
              Réessayer
            </button>
          </Card>
        )}

        {catalogVisible && offersQuery.isSuccess && offersQuery.data.length === 0 && (
          <Card className="p-6 text-center text-sm text-text-muted">
            Aucune offre disponible pour le moment.
          </Card>
        )}

        {catalogVisible && offersQuery.isSuccess && offersQuery.data.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {offersQuery.data.map((offer) => (
              <OfferCard
                key={offer.id}
                slug={slug}
                offer={offer}
                bookingEnabled={bookingEnabled}
                commerceEnabled={commerceEnabled}
                onBook={() => setBookingOffer(offer)}
                onAddToCart={() => addToCart(offer)}
              />
            ))}
          </div>
        )}
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
          shippingFlatRate={organization.shippingFlatRate}
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

function OfferCard({
  slug,
  offer,
  bookingEnabled,
  commerceEnabled,
  onBook,
  onAddToCart,
}: {
  slug: string;
  offer: PublicOffer;
  bookingEnabled: boolean;
  commerceEnabled: boolean;
  onBook: () => void;
  onAddToCart: () => void;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const thumbnail = offer.images[0];

  return (
    <Card className="p-4">
      {thumbnail && !imageFailed && (
        // Arbitrary tenant-supplied host, not one of Next's configured image domains (see
        // middleware.ts img-src comment).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="mb-3 h-32 w-full rounded-md object-cover"
        />
      )}
      <Link href={`/${slug}/offers/${offer.id}`} className="font-medium text-text hover:underline">
        {offer.name}
      </Link>
      <div className="mt-1 flex items-center gap-2">
        <Badge>{OFFER_TYPE_LABELS[offer.type]}</Badge>
      </div>
      {offer.description && <p className="mt-2 text-sm text-text-muted">{offer.description}</p>}
      <p className="mt-2 text-sm font-medium text-text">
        {formatOfferPrice(offer.pricing.amount, offer.pricing.currency)}
      </p>
      <div className="mt-3 flex gap-2">
        {offer.type === "booking" && bookingEnabled && (
          <Button variant="secondary" size="sm" onClick={onBook}>
            Réserver
          </Button>
        )}
        {offer.type !== "booking" && commerceEnabled && (
          <Button variant="secondary" size="sm" onClick={onAddToCart}>
            Ajouter au panier
          </Button>
        )}
        <Link
          href={`/${slug}/offers/${offer.id}`}
          className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-text-muted hover:underline"
        >
          Détails
        </Link>
      </div>
    </Card>
  );
}

/**
 * Fully optional — absent for every organization that hasn't set a tagline/heroImage, which
 * leaves the storefront looking exactly as it did before this section existed (see the
 * `organization.heroImage || organization.tagline` guard at the call site).
 */
function HeroSection({ organization }: { organization: PublicOrganization }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = organization.heroImage && !imageFailed;

  return (
    <div className="relative border-b border-border bg-surface-muted">
      {showImage && (
        // Arbitrary tenant-supplied host — same rationale as OfferCard's thumbnail above.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={organization.heroImage}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="h-48 w-full object-cover sm:h-64"
        />
      )}
      {organization.tagline && (
        <div className="mx-auto max-w-4xl px-6 py-4">
          <p className="text-sm text-text-muted sm:text-base">{organization.tagline}</p>
        </div>
      )}
    </div>
  );
}

/** Renders the organization's logo when it has one and it loads successfully; renders nothing otherwise. */
function OrganizationLogo({ organization }: { organization: PublicOrganization }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!organization.logo || imageFailed) {
    return null;
  }
  return (
    // Arbitrary tenant-supplied host, not one of Next's configured image domains — same
    // rationale as OfferCard's thumbnail above.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={organization.logo}
      alt=""
      loading="eager"
      referrerPolicy="no-referrer"
      onError={() => setImageFailed(true)}
      className="h-8 w-8 rounded object-contain"
    />
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-app-background text-sm text-text-muted">
      {children}
    </div>
  );
}

function StorefrontSkeleton() {
  return (
    <div className="min-h-screen bg-app-background">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto max-w-4xl">
          <div className="h-5 w-40 animate-pulse rounded bg-surface-muted" />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        <OffersSkeleton />
      </main>
    </div>
  );
}

function OffersSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {[0, 1, 2, 3].map((i) => (
        <Card key={i} className="p-4">
          <div className="mb-3 h-32 w-full animate-pulse rounded-md bg-surface-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface-muted" />
          <div className="mt-2 h-3 w-full animate-pulse rounded bg-surface-muted" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-surface-muted" />
        </Card>
      ))}
    </div>
  );
}
