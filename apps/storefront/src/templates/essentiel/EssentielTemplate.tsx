"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card } from "@korva/ui";
import { offerTypeLabel } from "@/lib/offer-labels";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { WishlistButton } from "@/app/[slug]/wishlist-button";
import { KT } from "../kt-classes";
import { PracticalInfo } from "../sections/PracticalInfo";
import { siteSubtitle } from "@/lib/site-subtitle";
import type { StorefrontTemplateProps } from "../types";
import { AboutSection } from "../sections/AboutSection";
import { TeamSection } from "../sections/TeamSection";
import { GallerySection } from "../sections/GallerySection";
import { TestimonialsSection } from "../sections/TestimonialsSection";
import { CustomerReviewsSection } from "../sections/CustomerReviews";
import { FaqSection } from "../sections/FaqSection";
import { OfferPrice } from "@/templates/sections/OfferPrice";
import { OfferImage } from "../sections/OfferImage";
import { SiteHeader, siteLinks } from "../sections/SiteHeader";
import { SiteFooter } from "../sections/SiteFooter";
import { Confirmation } from "../sections/Confirmation";
import { useStorefrontLocale, useT } from "@/lib/storefront-locale";
import { uploadImage } from "@/lib/upload-image";

/** The original, sector-agnostic storefront layout — always available regardless of plan, and
 *  the fallback whenever a plan no longer covers the org's chosen template (see
 *  PublicService#resolveStorefrontTheme). Neutral by design: the brand colour is its only accent. */
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
  const t = useT();
  const links = siteLinks(slug, catalogVisible, { catalog: t("Catalogue complet", "Full catalogue"), track: t("Suivre ma commande", "Track my order") });

  return (
    <div className={`flex min-h-screen flex-col ${KT.bg} ${KT.text} ${KT.bodyFont}`}>
      <SiteHeader
        slug={slug}
        organization={organization}
        links={links}
        authHydrated={authHydrated}
        isAuthenticated={isAuthenticated}
        customerFirstName={customerFirstName}
        commerceEnabled={commerceEnabled}
        cartCount={cartCount}
        onOpenCheckout={onOpenCheckout}
      />

      <HeroSection organization={organization} />

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <PracticalInfo organization={organization} commerceEnabled={commerceEnabled} bookingEnabled={bookingEnabled} />
        </div>
        <Confirmation message={confirmation} />

        {!catalogVisible && (
          <p className={`text-sm ${KT.textMuted}`}>{t(
            "Aucun catalogue disponible pour le moment.",
            "No catalogue available yet.",
          )}</p>
        )}

        {catalogVisible && offersLoading && <OffersSkeleton />}

        {catalogVisible && offersError && (
          <Card className="p-4 text-sm text-destructive">
            Impossible de charger les offres.{" "}
            <button onClick={onRetryOffers} className="underline">
              {t("Réessayer", "Try again")}
            </button>
          </Card>
        )}

        {catalogVisible && offers && offers.length === 0 && (
          <Card className={`p-6 text-center text-sm ${KT.textMuted}`}>{t(
            "Aucune offre disponible pour le moment.",
            "No offers available yet.",
          )}</Card>
        )}

        {catalogVisible && offers && offers.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {offers.map((offer, index) => (
              <OfferCard
                key={offer.id}
                slug={slug}
                offer={offer}
                priority={index < 2}
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
      <CustomerReviewsSection organization={organization} />
      <TestimonialsSection organization={organization} />
      <FaqSection organization={organization} />
      <SiteFooter organization={organization} links={links} />
    </div>
  );
}

function OfferCard({
  slug,
  offer,
  priority,
  bookingEnabled,
  commerceEnabled,
  onBook,
  onAddToCart,
}: {
  slug: string;
  offer: PublicOffer;
  priority: boolean;
  bookingEnabled: boolean;
  commerceEnabled: boolean;
  onBook: () => void;
  onAddToCart: () => void;
}) {
  const locale = useStorefrontLocale();
  const t = useT();
  return (
    <div className={`group flex flex-col overflow-hidden rounded-2xl border transition-shadow duration-200 hover:shadow-lg ${KT.surface} ${KT.border}`}>
      <Link href={`/${slug}/offers/${offer.id}`} tabIndex={-1} aria-hidden>
        <OfferImage offer={offer} priority={priority} zoomOnHover className="aspect-[4/3] w-full" />
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/${slug}/offers/${offer.id}`} className="font-medium hover:underline">
            {offer.name}
          </Link>
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
        <div className="mt-1">
          <Badge>{offerTypeLabel(offer.type, locale)}</Badge>
        </div>
        {offer.description && <p className={`mt-2 line-clamp-2 text-sm ${KT.textMuted}`}>{offer.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-4">
          <span className="font-semibold">
            <OfferPrice offer={offer} />
          </span>
          {offer.type === "booking" && bookingEnabled && (
            <Button size="sm" onClick={onBook} className={`${KT.accentBg} ${KT.accentContrastText}`}>
              {t("Réserver", "Book")}
            </Button>
          )}
          {offer.type !== "booking" && commerceEnabled && (
            <Button size="sm" onClick={onAddToCart} className={`${KT.accentBg} ${KT.accentContrastText}`}>
              {t("Ajouter", "Add")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The photo when there is one, the tagline when there is one — and when there is neither, the
 *  organization's name as a heading rather than a page that opens straight onto a grid. */
function HeroSection({ organization }: { organization: PublicOrganization }) {
  const t = useT();
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = organization.heroImage && !imageFailed;

  return (
    <div className={`border-b ${KT.border} ${KT.surface}`}>
      {showImage && (
        // Arbitrary tenant-supplied host — same rationale as OfferImage.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          {...uploadImage(organization.heroImage, [640, 960, 1280], "100vw")}
          alt=""
          fetchPriority="high"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImageFailed(true)}
          className="h-52 w-full object-cover sm:h-80"
        />
      )}
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <h1 className={`text-3xl font-semibold sm:text-4xl ${KT.headingFont}`}>{organization.name}</h1>
        <p className={`mt-2 max-w-xl text-base leading-relaxed sm:text-lg ${KT.textMuted}`}>
          {siteSubtitle(organization, t)}
        </p>
      </div>
    </div>
  );
}

function OffersSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-4">
          <div className="mb-3 aspect-[4/3] w-full animate-pulse rounded-xl bg-surface-muted" />
          <div className="h-4 w-2/3 animate-pulse rounded bg-surface-muted" />
          <div className="mt-2 h-3 w-full animate-pulse rounded bg-surface-muted" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-surface-muted" />
        </Card>
      ))}
    </div>
  );
}
