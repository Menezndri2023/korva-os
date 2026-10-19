"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card } from "@korva/ui";
import { OFFER_TYPE_LABELS } from "@/lib/offer-labels";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { WishlistButton } from "@/app/[slug]/wishlist-button";
import { KT } from "../kt-classes";
import type { StorefrontTemplateProps } from "../types";
import { AboutSection } from "../sections/AboutSection";
import { TeamSection } from "../sections/TeamSection";
import { GallerySection } from "../sections/GallerySection";
import { TestimonialsSection } from "../sections/TestimonialsSection";
import { FaqSection } from "../sections/FaqSection";
import { OfferPrice } from "@/templates/sections/OfferPrice";

/** The original, sector-agnostic storefront layout — always available regardless of plan, and
 *  the fallback whenever a plan no longer covers the org's chosen template (see
 *  PublicService#resolveStorefrontTheme). Visually unchanged from before the template system. */
export function EssentielTemplate({
  slug,
  organization,
  catalogVisible,
  offers,
  offersLoading,
  offersError,
  onRetryOffers,
  bookingEnabled,
  commerceEnabled,
  onBook,
  onAddToCart,
  cartCount,
  onOpenCheckout,
  confirmation,
  authHydrated,
  isAuthenticated,
  customerFirstName,
}: StorefrontTemplateProps) {
  return (
    <div className={`min-h-screen ${KT.bg} ${KT.text}`}>
      <header className={`border-b-[3px] ${KT.borderAccent} ${KT.surface} px-6 py-4`}>
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-3">
            <OrganizationLogo organization={organization} />
            <h1 className="text-lg font-semibold">{organization.name}</h1>
          </div>
          <div className="flex items-center gap-3">
            {catalogVisible && (
              <Link href={`/${slug}/catalogue`} className={`text-sm hover:underline ${KT.textMuted}`}>
                Catalogue complet
              </Link>
            )}
            <Link href={`/${slug}/track`} className={`text-sm hover:underline ${KT.textMuted}`}>
              Suivre ma commande
            </Link>
            {authHydrated && (
              <Link
                href={`/${slug}/account${isAuthenticated ? "" : "/login"}`}
                className={`text-sm hover:underline ${KT.textMuted}`}
              >
                {isAuthenticated ? (customerFirstName ?? "Mon compte") : "Se connecter"}
              </Link>
            )}
            {commerceEnabled && cartCount > 0 && (
              <Button size="sm" onClick={onOpenCheckout} className={`${KT.accentBg} ${KT.accentContrastText}`}>
                Panier ({cartCount})
              </Button>
            )}
          </div>
        </div>
      </header>

      {(organization.heroImage || organization.tagline) && <HeroSection organization={organization} />}

      <main className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        {confirmation && (
          <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800">
            {confirmation}
          </div>
        )}

        {!catalogVisible && (
          <p className={`text-sm ${KT.textMuted}`}>Aucun catalogue disponible pour le moment.</p>
        )}

        {catalogVisible && offersLoading && <OffersSkeleton />}

        {catalogVisible && offersError && (
          <Card className="p-4 text-sm text-destructive">
            Impossible de charger les offres.{" "}
            <button onClick={onRetryOffers} className="underline">
              Réessayer
            </button>
          </Card>
        )}

        {catalogVisible && offers && offers.length === 0 && (
          <Card className={`p-6 text-center text-sm ${KT.textMuted}`}>Aucune offre disponible pour le moment.</Card>
        )}

        {catalogVisible && offers && offers.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {offers.map((offer) => (
              <OfferCard
                key={offer.id}
                slug={slug}
                offer={offer}
                bookingEnabled={bookingEnabled}
                commerceEnabled={commerceEnabled}
                onBook={() => onBook(offer)}
                onAddToCart={() => onAddToCart(offer)}
              />
            ))}
          </div>
        )}
      </main>

      <AboutSection organization={organization} />
      <TeamSection organization={organization} />
      <GallerySection organization={organization} />
      <TestimonialsSection organization={organization} />
      <FaqSection organization={organization} />
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
    <Card
      className={`overflow-hidden rounded-xl p-4 shadow-sm transition-shadow duration-200 hover:shadow-lg ${KT.surface} ${KT.border}`}
    >
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
          className="-mx-4 -mt-4 mb-3 h-40 w-[calc(100%+2rem)] object-cover"
        />
      )}
      <div className="flex items-start justify-between gap-2">
        <Link href={`/${slug}/offers/${offer.id}`} className={`font-medium hover:underline ${KT.text}`}>
          {offer.name}
        </Link>
        <WishlistButton slug={slug} offerId={offer.id} />
      </div>
      <div className="mt-1 flex items-center gap-2">
        <Badge>{OFFER_TYPE_LABELS[offer.type]}</Badge>
      </div>
      {offer.description && <p className={`mt-2 text-sm ${KT.textMuted}`}>{offer.description}</p>}
      <p className={`mt-2 text-sm font-medium ${KT.text}`}>
        <OfferPrice offer={offer} />
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
          className={`inline-flex items-center px-3 py-1.5 text-sm font-medium hover:underline ${KT.textMuted}`}
        >
          Détails
        </Link>
      </div>
    </Card>
  );
}

function HeroSection({ organization }: { organization: PublicOrganization }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = organization.heroImage && !imageFailed;

  return (
    <div className={`relative border-b ${KT.border} ${KT.surface}`}>
      {showImage && (
        // Arbitrary tenant-supplied host — same rationale as OfferCard's thumbnail above.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={organization.heroImage}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="h-56 w-full object-cover sm:h-80"
        />
      )}
      {organization.tagline && (
        <div className="mx-auto max-w-4xl px-6 py-6">
          <p className={`max-w-xl text-base leading-relaxed sm:text-lg ${KT.textMuted}`}>
            {organization.tagline}
          </p>
        </div>
      )}
    </div>
  );
}

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
