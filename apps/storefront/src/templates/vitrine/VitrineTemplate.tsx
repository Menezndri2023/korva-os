"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@korva/ui";
import { OFFER_TYPE_LABELS } from "@/lib/offer-labels";
import type { PublicOffer } from "@/lib/public-types";
import { WishlistButton } from "@/app/[slug]/wishlist-button";
import { KT } from "../kt-classes";
import type { StorefrontTemplateProps } from "../types";
import { AboutSection } from "../sections/AboutSection";
import { TeamSection } from "../sections/TeamSection";
import { GallerySection } from "../sections/GallerySection";
import { TestimonialsSection } from "../sections/TestimonialsSection";
import { CustomerReviewsSection } from "../sections/CustomerReviews";
import { FaqSection } from "../sections/FaqSection";
import { SectionHeading } from "../sections/SectionHeading";
import { OfferPrice } from "@/templates/sections/OfferPrice";
import { OfferImage } from "../sections/OfferImage";
import { SiteHeader, siteLinks } from "../sections/SiteHeader";
import { SiteFooter } from "../sections/SiteFooter";
import { Confirmation } from "../sections/Confirmation";

/**
 * Services vitrine — professional services, trades/construction, real estate, digital
 * agencies, associations, events. Reads as a corporate/consultant site: a statement headline
 * hero, then services as large photo cards rather than a dense product grid.
 */
export function VitrineTemplate({
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
  const links = siteLinks(slug, catalogVisible, { catalog: "Tous nos services", track: "Suivi" });

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

      <section className={`px-4 py-14 sm:px-6 sm:py-20 ${KT.surface}`}>
        <div className="mx-auto grid max-w-5xl gap-10 sm:grid-cols-[1.2fr_1fr] sm:items-center">
          <div>
            <h1 className={`text-4xl font-semibold leading-tight sm:text-5xl ${KT.headingFont}`}>
              {organization.tagline || organization.name}
            </h1>
            {organization.tagline && (
              <p className={`mt-4 text-lg font-medium ${KT.accentText}`}>{organization.name}</p>
            )}
            <a
              href="#services"
              className={`mt-8 inline-flex rounded-full px-6 py-3 text-sm font-semibold shadow-md transition-shadow hover:shadow-lg ${KT.accentBg} ${KT.accentContrastText}`}
            >
              Découvrir nos services
            </a>
          </div>
          {organization.heroImage && <HeroImage src={organization.heroImage} />}
        </div>
      </section>

      <main id="services" className="mx-auto w-full max-w-5xl scroll-mt-20 px-4 py-14 sm:px-6 sm:py-16">
        <SectionHeading eyebrow="Ce que nous faisons" title="Nos services" />

        <Confirmation message={confirmation} />

        {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>Aucun service disponible pour le moment.</p>}

        {catalogVisible && offersLoading && <ListSkeleton />}

        {catalogVisible && offersError && (
          <div className={`rounded-2xl border ${KT.border} p-4 text-sm text-destructive`}>
            Impossible de charger les services.{" "}
            <button onClick={onRetryOffers} className="underline">Réessayer</button>
          </div>
        )}

        {catalogVisible && offers && offers.length === 0 && (
          <p className={`text-sm ${KT.textMuted}`}>Aucun service publié pour le moment.</p>
        )}

        {catalogVisible && offers && offers.length > 0 && (
          <ul className="grid gap-5 sm:grid-cols-2">
            {offers.map((offer) => (
              <ServiceCard
                key={offer.id}
                slug={slug}
                offer={offer}
                bookingEnabled={bookingEnabled}
                commerceEnabled={commerceEnabled}
                onBook={() => onBook(offer)}
                onAddToCart={() => onAddToCart(offer)}
              />
            ))}
          </ul>
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

/**
 * Was a numbered list (01, 02, 03…). Services are not a sequence, so the numbers said nothing;
 * the photo — the work itself, a property, a finished job — says far more.
 */
function ServiceCard({
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
  return (
    <li className={`group flex flex-col overflow-hidden rounded-2xl border transition-shadow duration-200 hover:shadow-lg ${KT.border} ${KT.surface}`}>
      <Link href={`/${slug}/offers/${offer.id}`} tabIndex={-1} aria-hidden>
        <OfferImage offer={offer} zoomOnHover className="aspect-[16/10] w-full" />
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/${slug}/offers/${offer.id}`} className={`text-lg font-semibold hover:underline ${KT.headingFont}`}>
            {offer.name}
          </Link>
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
        <p className={`mt-0.5 text-sm ${KT.textMuted}`}>{OFFER_TYPE_LABELS[offer.type]}</p>
        {offer.description && <p className={`mt-2 line-clamp-3 text-sm leading-relaxed ${KT.textMuted}`}>{offer.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <span className="font-semibold"><OfferPrice offer={offer} /></span>
          {offer.type === "booking" && bookingEnabled && (
            <Button size="sm" onClick={onBook} className={`${KT.accentBg} ${KT.accentContrastText}`}>Réserver</Button>
          )}
          {offer.type !== "booking" && commerceEnabled && (
            <Button variant="secondary" size="sm" onClick={onAddToCart}>Ajouter au panier</Button>
          )}
          {offer.type !== "booking" && !commerceEnabled && (
            <Link href={`/${slug}/offers/${offer.id}`} className={`text-sm font-medium hover:underline ${KT.accentText}`}>
              En savoir plus
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

function HeroImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      fetchPriority="high"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`h-64 w-full rounded-3xl border object-cover shadow-lg sm:h-80 ${KT.border}`}
    />
  );
}

function ListSkeleton() {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {[0, 1].map((i) => (
        <div key={i} className={`h-72 animate-pulse rounded-2xl ${KT.surface}`} />
      ))}
    </div>
  );
}
