"use client";

import Link from "next/link";
import { Button } from "@korva/ui";
import type { PublicOffer } from "@/lib/public-types";
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
import { SectionHeading } from "../sections/SectionHeading";
import { OfferPrice } from "@/templates/sections/OfferPrice";
import { OfferImage } from "../sections/OfferImage";
import { Monogram, SiteHeader, siteLinks } from "../sections/SiteHeader";
import { SiteFooter } from "../sections/SiteFooter";
import { siteWording } from "../wording";
import { Confirmation } from "../sections/Confirmation";
import { useStorefrontLocale, useT } from "@/lib/storefront-locale";
import { uploadImage } from "@/lib/upload-image";

/** Beauty & wellness, non-medical health, fitness, hospitality, personal services — booking is
 *  the primary call to action everywhere, well above cart/commerce. */
export function SalonTemplate({
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
  const bookableOffers = (offers ?? []).filter((o) => o.type === "booking");
  const otherOffers = (offers ?? []).filter((o) => o.type !== "booking");
  // Also the guesthouse template: its words follow the trade (siteWording).
  const words = siteWording(organization.businessModel, {
    catalogLink: t("Tous nos services", "All our services"),
    eyebrow: t("Sur rendez-vous", "By appointment"),
    title: t("Nos prestations", "Our services"),
    heroCta: t("Prendre rendez-vous", "Book an appointment"),
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

      {/* A full-height photo when the salon has one; without it, a compact welcome instead of the
          empty 28rem block this used to leave above the services. */}
      <div
        className={`relative flex flex-col items-center justify-center overflow-hidden px-6 text-center ${
          hasHeroImage ? "h-80 sm:h-[26rem]" : `py-14 sm:py-20 ${KT.surface}`
        }`}
      >
        {hasHeroImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              {...uploadImage(organization.heroImage, [640, 960, 1280], "100vw")}
              alt=""
              fetchPriority="high"
              decoding="async"
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-black/10" />
          </>
        )}
        <div className="relative z-10 flex flex-col items-center gap-4">
          <Monogram organization={organization} size="lg" />
          <h1 className={`text-4xl font-semibold sm:text-5xl ${KT.headingFont} ${hasHeroImage ? "text-white" : ""}`}>
            {organization.name}
          </h1>
          <p className={`max-w-md text-base leading-relaxed sm:text-lg ${hasHeroImage ? "text-white/90" : KT.textMuted}`}>
            {siteSubtitle(organization, t)}
          </p>
          {bookingEnabled && bookableOffers.length > 0 && (
            <a
              href="#services"
              className={`mt-2 inline-flex rounded-full px-7 py-3 text-sm font-semibold shadow-lg transition-shadow hover:shadow-xl ${KT.accentBg} ${KT.accentContrastText}`}
            >
              {words.heroCta}
            </a>
          )}
        </div>
      </div>

      <main id="services" className="mx-auto w-full max-w-3xl scroll-mt-20 space-y-12 px-4 py-10 sm:px-6 sm:py-14">
        <PracticalInfo organization={organization} commerceEnabled={commerceEnabled} bookingEnabled={bookingEnabled} />
        <Confirmation message={confirmation} />

        {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>{t(
          "Aucune prestation disponible pour le moment.",
          "No services available yet.",
        )}</p>}

        {catalogVisible && offersLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-24 animate-pulse rounded-2xl ${KT.surface}`} />
            ))}
          </div>
        )}

        {catalogVisible && offersError && (
          <div className={`rounded-2xl border ${KT.border} p-4 text-sm text-destructive`}>
            Impossible de charger les prestations.{" "}
            <button onClick={onRetryOffers} className="underline">{t("Réessayer", "Try again")}</button>
          </div>
        )}

        {catalogVisible && offers && offers.length === 0 && (
          <p className={`text-sm ${KT.textMuted}`}>{t(
            "Les prestations seront bientôt publiées.",
            "Services will be published soon.",
          )}</p>
        )}

        {catalogVisible && bookableOffers.length > 0 && (
          <section>
            <SectionHeading eyebrow={words.eyebrow} title={words.title} />
            <ul className="space-y-3">
              {bookableOffers.map((offer) => (
                <ServiceCard key={offer.id} slug={slug} offer={offer} primary onBook={() => onBook(offer)} />
              ))}
            </ul>
          </section>
        )}

        {catalogVisible && commerceEnabled && otherOffers.length > 0 && (
          <section>
            <SectionHeading eyebrow={t("À emporter", "Takeaway")} title={t("Nos produits", "Our products")} />
            <ul className="space-y-3">
              {otherOffers.map((offer) => (
                <ServiceCard key={offer.id} slug={slug} offer={offer} onAddToCart={() => onAddToCart(offer)} />
              ))}
            </ul>
          </section>
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

function ServiceCard({
  slug,
  offer,
  primary,
  onBook,
  onAddToCart,
}: {
  slug: string;
  offer: PublicOffer;
  primary?: boolean;
  onBook?: () => void;
  onAddToCart?: () => void;
}) {
  return (
    <li className={`flex items-start gap-4 rounded-2xl sm:items-center border p-3 transition-shadow duration-200 hover:shadow-md sm:p-4 ${KT.border} ${KT.surface}`}>
      <Link href={`/${slug}/offers/${offer.id}`} tabIndex={-1} aria-hidden className="shrink-0">
        <OfferImage offer={offer} className="h-20 w-20 rounded-xl sm:h-24 sm:w-24" />
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1">
          <Link href={`/${slug}/offers/${offer.id}`} className="font-medium hover:underline">{offer.name}</Link>
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
        {offer.description && <p className={`mt-0.5 line-clamp-2 text-sm ${KT.textMuted}`}>{offer.description}</p>}
        <p className="mt-1 text-sm">
          <span className="font-semibold"><OfferPrice offer={offer} /></span>
          {offer.durationMinutes ? <span className={KT.textMuted}> · {formatDuration(offer.durationMinutes)}</span> : null}
        </p>
        <div className="mt-2 sm:hidden">
          <ServiceAction primary={primary} onBook={onBook} onAddToCart={onAddToCart} size="sm" />
        </div>
      </div>
      {/* Beside the text from sm:, under it on a phone — a side button squeezed the name and
          description into a narrow column there. */}
      <div className="hidden sm:block">
        <ServiceAction primary={primary} onBook={onBook} onAddToCart={onAddToCart} />
      </div>
    </li>
  );
}

function ServiceAction({
  primary,
  onBook,
  onAddToCart,
  size = "md",
}: {
  primary?: boolean;
  onBook?: () => void;
  onAddToCart?: () => void;
  size?: "sm" | "md";
}) {
  const t = useT();
  if (primary && onBook) {
    return (
      <Button size={size} onClick={onBook} className={`${KT.accentBg} ${KT.accentContrastText}`}>
        {t("Réserver", "Book")}
      </Button>
    );
  }
  if (!primary && onAddToCart) {
    return (
      <Button size={size} variant="secondary" onClick={onAddToCart}>
        {t("Ajouter", "Add")}
      </Button>
    );
  }
  return null;
}

/** 45 → "45 min", 90 → "1 h 30", 180 → "3 h". */
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${String(rest).padStart(2, "0")}` : `${hours} h`;
}
