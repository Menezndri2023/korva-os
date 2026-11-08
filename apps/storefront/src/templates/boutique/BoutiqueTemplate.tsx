"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { OfferPrice } from "@/templates/sections/OfferPrice";
import { OfferImage } from "../sections/OfferImage";
import { SiteHeader, siteLinks } from "../sections/SiteHeader";
import { SiteFooter } from "../sections/SiteFooter";
import { Confirmation } from "../sections/Confirmation";
import { useT } from "@/lib/storefront-locale";
import { uploadImage } from "@/lib/upload-image";

const ALL_CATEGORY = "Tout";

/** Commerce/e-commerce, fashion, food retail, direct-sale agriculture — a dense product grid
 *  with category filter pills, closer to an online shop than a services page. */
export function BoutiqueTemplate({
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
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const offer of offers ?? []) {
      for (const category of offer.categories) set.add(category);
    }
    return [ALL_CATEGORY, ...Array.from(set)];
  }, [offers]);
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORY);
  const visibleOffers = useMemo(() => {
    if (activeCategory === ALL_CATEGORY) return offers ?? [];
    return (offers ?? []).filter((o) => o.categories.includes(activeCategory));
  }, [offers, activeCategory]);

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

      {organization.heroImage ? (
        <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
          <HeroBanner src={organization.heroImage} title={organization.name} tagline={siteSubtitle(organization, t)} />
        </div>
      ) : (
        <section className={`py-8 sm:py-12 ${KT.accentBg} ${KT.accentContrastText}`}>
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h1 className={`text-3xl font-semibold leading-tight sm:text-4xl ${KT.headingFont}`}>{organization.name}</h1>
            <p className="mt-2 max-w-xl text-base opacity-90 sm:text-lg">{siteSubtitle(organization, t)}</p>
            {catalogVisible && (
              <a
                href="#catalogue"
                className={`mt-5 inline-flex rounded-full px-6 py-2.5 text-sm font-semibold shadow-sm ${KT.bg} ${KT.text}`}
              >
                {t("Voir le catalogue", "See the catalogue")}
              </a>
            )}
          </div>
        </section>
      )}

      <div className="mx-auto w-full max-w-6xl px-4 pt-6 sm:px-6">
        <PracticalInfo organization={organization} commerceEnabled={commerceEnabled} bookingEnabled={bookingEnabled} />
      </div>

      <main id="catalogue" className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-6 sm:px-6 sm:py-8">
        <Confirmation message={confirmation} />

        {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>{t(
          "Le catalogue n'est pas disponible pour le moment.",
          "The catalogue is not available at the moment.",
        )}</p>}

        {catalogVisible && categories.length > 1 && (
          // One scrolling row on a phone rather than pills wrapping over three lines.
          <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                aria-pressed={activeCategory === category}
                className={
                  activeCategory === category
                    ? `shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${KT.accentBg} ${KT.accentContrastText} ${KT.borderAccent}`
                    : `shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${KT.border} ${KT.surface} ${KT.textMuted} ${KT.accentSoftHoverBg}`
                }
              >
                {category === ALL_CATEGORY ? t("Tout", "All") : category}
              </button>
            ))}
          </div>
        )}

        {catalogVisible && offersLoading && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={`aspect-square animate-pulse rounded-2xl ${KT.surface}`} />
            ))}
          </div>
        )}

        {catalogVisible && offersError && (
          <div className={`rounded-2xl border ${KT.border} p-4 text-sm text-destructive`}>
            Impossible de charger le catalogue.{" "}
            <button onClick={onRetryOffers} className="underline">{t("Réessayer", "Try again")}</button>
          </div>
        )}

        {catalogVisible && offers && visibleOffers.length === 0 && (
          <p className={`text-sm ${KT.textMuted}`}>
            {activeCategory !== ALL_CATEGORY
              ? t("Aucun produit dans cette catégorie.", "No products in this category.")
              : t("Aucun produit en ligne pour le moment.", "No products online yet.")}
          </p>
        )}

        {catalogVisible && visibleOffers.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {visibleOffers.map((offer, index) => (
              <ProductCard
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

function ProductCard({
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
  const t = useT();
  return (
    <div className={`group flex flex-col overflow-hidden rounded-2xl border transition-shadow duration-200 hover:shadow-lg ${KT.border} ${KT.surface}`}>
      <div className="relative">
        <Link href={`/${slug}/offers/${offer.id}`} tabIndex={-1} aria-hidden>
          <OfferImage offer={offer} priority={priority} zoomOnHover className="aspect-square w-full" />
        </Link>
        <div className={`absolute right-2 top-2 rounded-full ${KT.surface}`}>
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
      </div>
      <div className="flex flex-1 flex-col p-3 sm:p-4">
        <Link href={`/${slug}/offers/${offer.id}`} className="line-clamp-2 text-sm font-medium hover:underline sm:text-base">
          {offer.name}
        </Link>
        <p className={`mt-1 text-sm font-semibold sm:text-base ${KT.accentText}`}>
          <OfferPrice offer={offer} />
        </p>
        <div className="mt-auto pt-3">
          {offer.type === "booking" && bookingEnabled && (
            <Button variant="secondary" size="sm" className="w-full" onClick={onBook}>{t("Réserver", "Book")}</Button>
          )}
          {offer.type !== "booking" && commerceEnabled && (
            <Button size="sm" className={`w-full ${KT.accentBg} ${KT.accentContrastText}`} onClick={onAddToCart}>
              {t("Ajouter", "Add")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroBanner({ src, title, tagline }: { src: string; title: string; tagline?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="relative overflow-hidden rounded-3xl">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        {...uploadImage(src, [640, 960, 1280], "100vw")}
        alt=""
        fetchPriority="high"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-52 w-full object-cover sm:h-80"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/20 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5 text-white sm:p-8">
        <h1 className={`text-2xl font-semibold sm:text-4xl ${KT.headingFont}`}>{title}</h1>
        {tagline && <p className="mt-1 max-w-xl text-sm text-white/85 sm:text-base">{tagline}</p>}
      </div>
    </div>
  );
}
