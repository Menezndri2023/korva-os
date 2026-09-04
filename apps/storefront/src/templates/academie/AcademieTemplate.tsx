"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@korva/ui";
import { OFFER_TYPE_LABELS, formatOfferPrice } from "@/lib/offer-labels";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { WishlistButton } from "@/app/[slug]/wishlist-button";
import { KT } from "../kt-classes";
import type { StorefrontTemplateProps } from "../types";
import { AboutSection } from "../sections/AboutSection";
import { TeamSection } from "../sections/TeamSection";
import { GallerySection } from "../sections/GallerySection";
import { TestimonialsSection } from "../sections/TestimonialsSection";
import { FaqSection } from "../sections/FaqSection";

/** Training/coaching — offers presented as course cards (accent top bar, type badge, price,
 *  enrolment CTA) in a catalog grid, closer to an academy/course-platform look. */
export function AcademieTemplate({
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
    <div className={`min-h-screen ${KT.bg} ${KT.text} ${KT.bodyFont}`}>
      <header className={`px-6 py-8 ${KT.accentBg} ${KT.accentContrastText}`}>
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo organization={organization} />
            <span className={`text-lg font-semibold ${KT.headingFont}`}>{organization.name}</span>
          </div>
          <div className="flex items-center gap-4 text-sm opacity-90">
            {catalogVisible && (
              <Link href={`/${slug}/catalogue`} className="hover:underline">Toutes nos formations</Link>
            )}
            <Link href={`/${slug}/track`} className="hover:underline">Suivi</Link>
            {authHydrated && (
              <Link href={`/${slug}/account${isAuthenticated ? "" : "/login"}`} className="hover:underline">
                {isAuthenticated ? (customerFirstName ?? "Mon espace") : "Se connecter"}
              </Link>
            )}
            {commerceEnabled && cartCount > 0 && (
              <Link href="#" onClick={(e) => { e.preventDefault(); onOpenCheckout(); }} className="rounded-md bg-white/15 px-3 py-1.5 font-medium hover:bg-white/25">
                Panier ({cartCount})
              </Link>
            )}
          </div>
        </div>
        <div className="mx-auto mt-10 max-w-5xl">
          <h1 className={`text-3xl font-semibold leading-tight sm:text-4xl ${KT.headingFont}`}>
            {organization.tagline || `Les formations ${organization.name}`}
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {confirmation && (
          <div className="mb-4 rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800">{confirmation}</div>
        )}

        {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>Aucune formation disponible pour le moment.</p>}

        {catalogVisible && offersLoading && (
          <div className="grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-40 animate-pulse rounded-lg ${KT.surface}`} />
            ))}
          </div>
        )}

        {catalogVisible && offersError && (
          <div className={`rounded-md border ${KT.border} p-4 text-sm text-destructive`}>
            Impossible de charger les formations.{" "}
            <button onClick={onRetryOffers} className="underline">Réessayer</button>
          </div>
        )}

        {catalogVisible && offers && offers.length === 0 && (
          <p className={`text-sm ${KT.textMuted}`}>Les prochaines sessions seront bientôt publiées.</p>
        )}

        {catalogVisible && offers && offers.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2">
            {offers.map((offer) => (
              <CourseCard
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

function CourseCard({
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
    <div
      className={`overflow-hidden rounded-xl border shadow-sm transition-shadow duration-200 hover:shadow-lg ${KT.border} ${KT.surface}`}
    >
      <div className={`h-2 ${KT.accentBg}`} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/${slug}/offers/${offer.id}`} className={`font-medium hover:underline ${KT.headingFont}`}>
            {offer.name}
          </Link>
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${KT.bg} ${KT.textMuted}`}>
          {OFFER_TYPE_LABELS[offer.type]}
        </span>
        {offer.description && <p className={`mt-2 text-sm ${KT.textMuted}`}>{offer.description}</p>}
        <div className="mt-3 flex items-center justify-between">
          <span className="font-medium">{formatOfferPrice(offer.pricing.amount, offer.pricing.currency)}</span>
          {offer.type === "booking" && bookingEnabled && (
            <Button size="sm" onClick={onBook} className={`${KT.accentBg} ${KT.accentContrastText}`}>
              S&apos;inscrire
            </Button>
          )}
          {offer.type !== "booking" && commerceEnabled && (
            <Button variant="secondary" size="sm" onClick={onAddToCart}>Ajouter</Button>
          )}
        </div>
      </div>
    </div>
  );
}

function Logo({ organization }: { organization: PublicOrganization }) {
  const [failed, setFailed] = useState(false);
  if (!organization.logo || failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={organization.logo}
      alt=""
      loading="eager"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="h-8 w-8 rounded bg-white/10 object-contain"
    />
  );
}
