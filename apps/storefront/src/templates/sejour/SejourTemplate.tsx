"use client";

import Link from "next/link";
import { Button } from "@korva/ui";
import type { PublicOffer } from "@/lib/public-types";
import { WishlistButton } from "@/app/[slug]/wishlist-button";
import { KT } from "../kt-classes";
import { HeroSlides, heroImagesOf } from "../sections/HeroSlides";
import { FeaturedBadge } from "../sections/FeaturedBadge";
import { PracticalInfo } from "../sections/PracticalInfo";
import { siteSubtitle } from "@/lib/site-subtitle";
import type { StorefrontTemplateProps } from "../types";
import { AboutSection } from "../sections/AboutSection";
import { GallerySection } from "../sections/GallerySection";
import { TestimonialsSection } from "../sections/TestimonialsSection";
import { CustomerReviewsSection } from "../sections/CustomerReviews";
import { FaqSection } from "../sections/FaqSection";
import { SectionHeading } from "../sections/SectionHeading";
import { OfferPrice } from "@/templates/sections/OfferPrice";
import { OfferImage } from "../sections/OfferImage";
import { SiteHeader, siteLinks } from "../sections/SiteHeader";
import { SiteFooter } from "../sections/SiteFooter";
import { siteWording } from "../wording";
import { Confirmation } from "../sections/Confirmation";
import { optionLabel, roomFacts } from "../sections/listing-facts";
import { useStorefrontLocale, useT } from "@/lib/storefront-locale";

/** How many amenities a room card lists before "+ N". */
const AMENITIES_ON_CARD = 4;

/**
 * Hotels, guesthouses, gîtes. Used to borrow "salon", whose small thumbnails in a list suit a
 * haircut, not a room: a guest chooses a room by its photo, how many it sleeps and what is in
 * it. Rooms are large photo cards with those facts and a per-night price; extras (breakfast, an
 * airport transfer) follow as a short list.
 */
export function SejourTemplate({
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
  const locale = useStorefrontLocale();
  const t = useT();
  const rooms = (offers ?? []).filter((o) => o.type === "booking");
  const extras = (offers ?? []).filter((o) => o.type !== "booking");
  const words = siteWording(organization.businessModel, {
    catalogLink: t("Toutes nos chambres", "All our rooms"),
    eyebrow: t("Séjours", "Stays"),
    title: t("Nos chambres", "Our rooms"),
    heroCta: t("Réserver un séjour", "Book a stay"),
    book: t("Réserver", "Book"),
  }, locale);
  const links = siteLinks(slug, catalogVisible, { catalog: words.catalogLink, track: t("Suivre ma réservation", "Track my booking") });
  const hasHeroImage = Boolean(organization.heroImage);

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

      <section
        className={`relative flex items-end overflow-hidden px-4 sm:px-6 ${
          hasHeroImage ? "h-[22rem] sm:h-[30rem]" : `py-16 sm:py-24 ${KT.surface}`
        }`}
      >
        {hasHeroImage && (
          <>
            <HeroSlides images={heroImagesOf(organization)} fill />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent" />
          </>
        )}
        <div className={`relative z-10 mx-auto w-full max-w-5xl ${hasHeroImage ? "pb-10 text-white" : ""}`}>
          <h1 className={`max-w-2xl text-4xl font-semibold leading-tight sm:text-5xl ${KT.headingFont}`}>
            {organization.name}
          </h1>
          <p className={`mt-3 max-w-xl text-base sm:text-lg ${hasHeroImage ? "text-white/90" : KT.textMuted}`}>
            {organization.tagline || siteSubtitle(organization, t)}
          </p>
          {bookingEnabled && rooms.length > 0 && (
            <a
              href="#chambres"
              className={`mt-6 inline-flex rounded-full px-7 py-3 text-sm font-semibold shadow-lg transition-shadow hover:shadow-xl ${KT.accentBg} ${KT.accentContrastText}`}
            >
              {words.heroCta}
            </a>
          )}
        </div>
      </section>

      <div className="mx-auto w-full max-w-5xl px-4 pt-10 sm:px-6">
        <PracticalInfo organization={organization} commerceEnabled={commerceEnabled} bookingEnabled={bookingEnabled} />
      </div>

      <main id="chambres" className="mx-auto w-full max-w-5xl scroll-mt-20 space-y-14 px-4 py-12 sm:px-6 sm:py-16">
        <Confirmation message={confirmation} />

        {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>{t(
          "Aucune chambre disponible pour le moment.",
          "No rooms available yet.",
        )}</p>}

        {catalogVisible && offersLoading && (
          <div className="grid gap-6 sm:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className={`h-80 animate-pulse rounded-3xl ${KT.surface}`} />
            ))}
          </div>
        )}

        {catalogVisible && offersError && (
          <div className={`rounded-2xl border ${KT.border} p-4 text-sm text-destructive`}>
            {t("Impossible de charger les chambres.", "The rooms could not be loaded.")}{" "}
            <button onClick={onRetryOffers} className="underline">{t("Réessayer", "Try again")}</button>
          </div>
        )}

        {catalogVisible && offers && offers.length === 0 && (
          <p className={`text-sm ${KT.textMuted}`}>{t(
            "Les chambres seront bientôt publiées.",
            "Rooms will be published soon.",
          )}</p>
        )}

        {catalogVisible && rooms.length > 0 && (
          <section>
            <SectionHeading eyebrow={words.eyebrow} title={words.title} />
            <ul className="grid gap-6 sm:grid-cols-2">
              {rooms.map((offer) => (
                <RoomCard
                  key={offer.id}
                  slug={slug}
                  offer={offer}
                  bookLabel={words.book}
                  onBook={bookingEnabled ? () => onBook(offer) : undefined}
                />
              ))}
            </ul>
          </section>
        )}

        {catalogVisible && extras.length > 0 && (
          <section>
            <SectionHeading eyebrow={t("Pendant votre séjour", "During your stay")} title={t("Services et extras", "Services and extras")} />
            <ul className={`divide-y rounded-2xl border ${KT.border} ${KT.surface}`}>
              {extras.map((offer) => (
                <li key={offer.id} className={`flex items-center justify-between gap-4 p-4 ${KT.border}`}>
                  <div className="min-w-0">
                    <Link href={`/${slug}/offers/${offer.id}`} className="font-medium hover:underline">{offer.name}</Link>
                    {offer.description && <p className={`line-clamp-1 text-sm ${KT.textMuted}`}>{offer.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold"><OfferPrice offer={offer} /></span>
                    {commerceEnabled && (
                      <Button size="sm" variant="secondary" onClick={() => onAddToCart(offer)}>{t("Ajouter", "Add")}</Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <GallerySection organization={organization} />
      <AboutSection organization={organization} />
      <CustomerReviewsSection organization={organization} />
      <TestimonialsSection organization={organization} />
      <FaqSection organization={organization} />
      <SiteFooter organization={organization} links={links} />
    </div>
  );
}

function RoomCard({
  slug,
  offer,
  bookLabel,
  onBook,
}: {
  slug: string;
  offer: PublicOffer;
  bookLabel: string;
  onBook?: () => void;
}) {
  const locale = useStorefrontLocale();
  const t = useT();
  const facts = roomFacts(offer);
  const chips = [
    facts.guests ? t(`${facts.guests} pers.`, `Sleeps ${facts.guests}`) : null,
    facts.beds ?? null,
    facts.surface ? `${facts.surface} m²` : null,
  ].filter((chip): chip is string => Boolean(chip));
  const shown = facts.amenities.slice(0, AMENITIES_ON_CARD);
  const more = facts.amenities.length - shown.length;
  const perNight = offer.bookingUnit === "night";

  return (
    <li className={`group flex flex-col overflow-hidden rounded-3xl border transition-shadow duration-200 hover:shadow-xl ${KT.border} ${KT.surface}`}>
      <Link href={`/${slug}/offers/${offer.id}`} tabIndex={-1} aria-hidden>
        <OfferImage offer={offer} zoomOnHover className="aspect-[4/3] w-full" />
      </Link>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/${slug}/offers/${offer.id}`} className={`text-xl font-semibold hover:underline ${KT.headingFont}`}>
            <FeaturedBadge offer={offer} />{offer.name}
          </Link>
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
        {chips.length > 0 && (
          <p className={`mt-1 text-sm ${KT.textMuted}`}>{chips.join(" · ")}</p>
        )}
        {shown.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t("Équipements", "Amenities")}>
            {shown.map((amenity) => (
              <li key={amenity} className={`rounded-full border px-2.5 py-0.5 text-xs ${KT.border}`}>
                {optionLabel(amenity, locale)}
              </li>
            ))}
            {more > 0 && <li className={`px-1 py-0.5 text-xs ${KT.textMuted}`}>+ {more}</li>}
          </ul>
        )}
        {offer.description && <p className={`mt-3 line-clamp-2 text-sm leading-relaxed ${KT.textMuted}`}>{offer.description}</p>}
        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <span>
            <span className="text-lg font-semibold"><OfferPrice offer={offer} /></span>
            {perNight && <span className={`text-sm ${KT.textMuted}`}> {t("/ nuit", "/ night")}</span>}
          </span>
          {onBook && (
            <Button onClick={onBook} className={`${KT.accentBg} ${KT.accentContrastText}`}>{bookLabel}</Button>
          )}
        </div>
      </div>
    </li>
  );
}
