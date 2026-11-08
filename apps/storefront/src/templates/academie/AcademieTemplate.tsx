"use client";

import Link from "next/link";
import { Button } from "@korva/ui";
import { offerTypeLabel } from "@/lib/offer-labels";
import type { PublicOffer } from "@/lib/public-types";
import { WishlistButton } from "@/app/[slug]/wishlist-button";
import { KT } from "../kt-classes";
import { PracticalInfo } from "../sections/PracticalInfo";
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

/** Training/coaching — offers presented as course cards (cover image, type badge, price,
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
  const t = useT();
  const links = siteLinks(slug, catalogVisible, { catalog: t("Toutes nos formations", "All our courses"), track: t("Suivi", "Tracking") });

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
        tone="accent"
      />

      <section className={`px-4 pb-14 pt-8 sm:px-6 sm:pb-20 sm:pt-12 ${KT.accentBg} ${KT.accentContrastText}`}>
        <div className="mx-auto max-w-5xl">
          <h1 className={`max-w-3xl text-3xl font-semibold leading-tight sm:text-5xl ${KT.headingFont}`}>
            {organization.tagline || `Les formations ${organization.name}`}
          </h1>
          {catalogVisible && offers && offers.length > 0 && (
            <p className="mt-4 text-base opacity-90">
              {offers.length} formation{offers.length > 1 ? "s" : ""} ouverte{offers.length > 1 ? "s" : ""} aux inscriptions
            </p>
          )}
        </div>
      </section>

      <main className="mx-auto -mt-8 w-full max-w-5xl px-4 pb-12 sm:px-6">
        <div className="mb-8">
          <PracticalInfo organization={organization} commerceEnabled={commerceEnabled} bookingEnabled={bookingEnabled} />
        </div>
        <Confirmation message={confirmation} />

        {!catalogVisible && <p className={`pt-12 text-sm ${KT.textMuted}`}>{t(
          "Aucune formation disponible pour le moment.",
          "No courses available yet.",
        )}</p>}

        {catalogVisible && offersLoading && (
          <div className="grid gap-5 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className={`h-72 animate-pulse rounded-2xl ${KT.surface}`} />
            ))}
          </div>
        )}

        {catalogVisible && offersError && (
          <div className={`rounded-2xl border ${KT.border} ${KT.surface} p-4 text-sm text-destructive`}>
            Impossible de charger les formations.{" "}
            <button onClick={onRetryOffers} className="underline">{t("Réessayer", "Try again")}</button>
          </div>
        )}

        {catalogVisible && offers && offers.length === 0 && (
          <p className={`rounded-2xl border p-6 text-sm ${KT.border} ${KT.surface} ${KT.textMuted}`}>
            {t(
              "Les prochaines sessions seront bientôt publiées.",
              "The next sessions will be published soon.",
            )}
          </p>
        )}

        {catalogVisible && offers && offers.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2">
            {offers.map((offer, index) => (
              <CourseCard
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

function CourseCard({
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
    <div className={`group flex flex-col overflow-hidden rounded-2xl border shadow-sm transition-shadow duration-200 hover:shadow-lg ${KT.border} ${KT.surface}`}>
      <Link href={`/${slug}/offers/${offer.id}`} tabIndex={-1} aria-hidden>
        <OfferImage offer={offer} priority={priority} zoomOnHover className="aspect-video w-full" />
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <span className={`self-start rounded-full px-2.5 py-0.5 text-xs font-medium ${KT.accentSoftBg} ${KT.accentText}`}>
          {offerTypeLabel(offer.type, locale)}
        </span>
        <div className="mt-2 flex items-start justify-between gap-2">
          <Link href={`/${slug}/offers/${offer.id}`} className={`text-lg font-semibold hover:underline ${KT.headingFont}`}>
            {offer.name}
          </Link>
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
        {offer.description && <p className={`mt-1 line-clamp-3 text-sm leading-relaxed ${KT.textMuted}`}>{offer.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <span className="font-semibold"><OfferPrice offer={offer} /></span>
          {offer.type === "booking" && bookingEnabled && (
            <Button size="sm" onClick={onBook} className={`${KT.accentBg} ${KT.accentContrastText}`}>
              {t("S'inscrire", "Sign up")}
            </Button>
          )}
          {offer.type !== "booking" && commerceEnabled && (
            <Button variant="secondary" size="sm" onClick={onAddToCart}>{t("Ajouter", "Add")}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
