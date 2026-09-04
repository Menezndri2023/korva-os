"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@korva/ui";
import { formatOfferPrice } from "@/lib/offer-labels";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { WishlistButton } from "@/app/[slug]/wishlist-button";
import { KT } from "../kt-classes";
import type { StorefrontTemplateProps } from "../types";
import { AboutSection } from "../sections/AboutSection";
import { TeamSection } from "../sections/TeamSection";
import { GallerySection } from "../sections/GallerySection";
import { TestimonialsSection } from "../sections/TestimonialsSection";

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

  return (
    <div className={`min-h-screen ${KT.bg} ${KT.text} ${KT.bodyFont}`}>
      <header className={`border-b ${KT.border} ${KT.surface} px-6 py-4`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo organization={organization} />
            <span className={`text-lg font-semibold ${KT.headingFont}`}>{organization.name}</span>
          </div>
          <div className={`flex items-center gap-4 text-sm ${KT.textMuted}`}>
            {catalogVisible && (
              <Link href={`/${slug}/catalogue`} className="hover:underline">Catalogue complet</Link>
            )}
            <Link href={`/${slug}/track`} className="hover:underline">Suivre ma commande</Link>
            {authHydrated && (
              <Link href={`/${slug}/account${isAuthenticated ? "" : "/login"}`} className="hover:underline">
                {isAuthenticated ? (customerFirstName ?? "Mon compte") : "Se connecter"}
              </Link>
            )}
            <Button size="sm" onClick={onOpenCheckout} disabled={cartCount === 0} className={`${KT.accentBg} ${KT.accentContrastText}`}>
              Panier ({cartCount})
            </Button>
          </div>
        </div>
      </header>

      <section className={`px-6 py-3 ${KT.accentBg} ${KT.accentContrastText}`}>
        <p className="mx-auto max-w-6xl text-center text-sm font-medium">
          {organization.tagline || `Bienvenue chez ${organization.name}`}
        </p>
      </section>

      {organization.heroImage && (
        <div className="mx-auto max-w-6xl px-6 pt-6">
          <HeroBanner src={organization.heroImage} />
        </div>
      )}

      <main className="mx-auto max-w-6xl px-6 py-8">
        {confirmation && (
          <div className="mb-4 rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800">{confirmation}</div>
        )}

        {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>Le catalogue n&apos;est pas disponible pour le moment.</p>}

        {catalogVisible && categories.length > 1 && (
          <div className="mb-5 flex flex-wrap gap-2">
            {categories.map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={
                  activeCategory === category
                    ? `rounded-full border px-3 py-1 text-xs font-medium ${KT.accentBg} ${KT.accentContrastText} ${KT.borderAccent}`
                    : `rounded-full border px-3 py-1 text-xs font-medium ${KT.border} ${KT.textMuted}`
                }
              >
                {category}
              </button>
            ))}
          </div>
        )}

        {catalogVisible && offersLoading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={`h-56 animate-pulse rounded-md ${KT.surface}`} />
            ))}
          </div>
        )}

        {catalogVisible && offersError && (
          <div className={`rounded-md border ${KT.border} p-4 text-sm text-destructive`}>
            Impossible de charger le catalogue.{" "}
            <button onClick={onRetryOffers} className="underline">Réessayer</button>
          </div>
        )}

        {catalogVisible && offers && visibleOffers.length === 0 && (
          <p className={`text-sm ${KT.textMuted}`}>Aucun produit dans cette catégorie.</p>
        )}

        {catalogVisible && visibleOffers.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleOffers.map((offer) => (
              <ProductCard
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
    </div>
  );
}

function ProductCard({
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
    <div className={`overflow-hidden rounded-lg border ${KT.border} ${KT.surface}`}>
      <div className={`relative aspect-square ${KT.bg}`}>
        {thumbnail && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className={`flex h-full items-center justify-center text-xs ${KT.textMuted}`}>Pas d&apos;image</div>
        )}
        <div className="absolute right-2 top-2">
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
      </div>
      <div className="p-3">
        <Link href={`/${slug}/offers/${offer.id}`} className="text-sm font-medium hover:underline">
          {offer.name}
        </Link>
        <p className={`mt-1 text-sm font-semibold ${KT.accentText}`}>
          {formatOfferPrice(offer.pricing.amount, offer.pricing.currency)}
        </p>
        <div className="mt-2">
          {offer.type === "booking" && bookingEnabled && (
            <Button variant="secondary" size="sm" className="w-full" onClick={onBook}>Réserver</Button>
          )}
          {offer.type !== "booking" && commerceEnabled && (
            <Button size="sm" className={`w-full ${KT.accentBg} ${KT.accentContrastText}`} onClick={onAddToCart}>
              Ajouter au panier
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function HeroBanner({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-40 w-full rounded-lg object-cover sm:h-56" />
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
      className="h-8 w-8 rounded object-contain"
    />
  );
}
