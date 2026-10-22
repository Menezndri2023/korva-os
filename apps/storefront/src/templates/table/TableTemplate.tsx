"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Button } from "@korva/ui";
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
import { OfferPrice } from "@/templates/sections/OfferPrice";
import { OfferImage } from "../sections/OfferImage";
import { SiteHeader, siteLinks } from "../sections/SiteHeader";
import { SiteFooter } from "../sections/SiteFooter";
import { Confirmation } from "../sections/Confirmation";

const UNCATEGORIZED = "Autres";

/** Restaurant/food — a full-bleed hero banner and a menu grouped by category, styled like a
 *  restaurant's carte rather than a generic product grid. */
export function TableTemplate({
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
  const groups = useMemo(() => groupByCategory(offers), [offers]);
  const links = siteLinks(slug, catalogVisible, { catalog: "Menu complet", track: "Suivre ma commande" });
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

      <div
        className={`relative flex flex-col items-center justify-center overflow-hidden px-6 text-center ${
          hasHeroImage ? "h-72 sm:h-96" : `py-14 sm:py-20 ${KT.surface}`
        }`}
      >
        {hasHeroImage && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={organization.heroImage}
              alt=""
              fetchPriority="high"
              decoding="async"
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />
          </>
        )}
        <div className="relative z-10">
          <h1 className={`text-4xl font-semibold sm:text-5xl ${KT.headingFont} ${hasHeroImage ? "text-white" : ""}`}>
            {organization.name}
          </h1>
          {organization.tagline && (
            <p className={`mt-3 text-base sm:text-lg ${hasHeroImage ? "text-white/90" : KT.textMuted}`}>{organization.tagline}</p>
          )}
        </div>
      </div>

      {/* The menu's sections as a sticky row of jump links: a long carte on a phone is otherwise
          one endless scroll to find the desserts. */}
      {catalogVisible && groups.length > 1 && (
        <nav
          aria-label="Rubriques de la carte"
          className={`sticky top-16 z-20 border-b ${KT.border} ${KT.bg}`}
        >
          <div className="mx-auto flex max-w-3xl gap-2 overflow-x-auto px-4 py-3 sm:px-6">
            {groups.map(([category]) => (
              <a
                key={category}
                href={`#${categoryAnchor(category)}`}
                className={`shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium ${KT.border} ${KT.surface} ${KT.accentSoftHoverBg}`}
              >
                {category}
              </a>
            ))}
          </div>
        </nav>
      )}

      <main className="mx-auto w-full max-w-3xl space-y-10 px-4 py-10 sm:px-6">
        <Confirmation message={confirmation} />

        {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>La carte n&apos;est pas disponible pour le moment.</p>}

        {catalogVisible && offersLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-16 animate-pulse rounded-xl ${KT.surface}`} />
            ))}
          </div>
        )}

        {catalogVisible && offersError && (
          <div className={`rounded-2xl border ${KT.border} p-4 text-sm text-destructive`}>
            Impossible de charger la carte.{" "}
            <button onClick={onRetryOffers} className="underline">Réessayer</button>
          </div>
        )}

        {catalogVisible && offers && offers.length === 0 && (
          <p className={`text-sm ${KT.textMuted}`}>La carte sera bientôt disponible.</p>
        )}

        {catalogVisible &&
          groups.map(([category, items]) => (
            <section key={category} id={categoryAnchor(category)} className="scroll-mt-32">
              <h2 className={`border-b-2 pb-3 text-2xl font-semibold ${KT.borderAccent} ${KT.text} ${KT.headingFont}`}>
                {category}
              </h2>
              <ul className={`mt-2 divide-y ${KT.border}`}>
                {items.map((offer) => (
                  <MenuRow
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
            </section>
          ))}
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

function MenuRow({
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
    <li className="flex items-start gap-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className="flex items-center gap-1">
            <Link href={`/${slug}/offers/${offer.id}`} className="font-medium hover:underline">
              {offer.name}
            </Link>
            <WishlistButton slug={slug} offerId={offer.id} />
          </div>
          <span className={`whitespace-nowrap text-base font-semibold ${KT.accentText}`}>
            <OfferPrice offer={offer} />
          </span>
        </div>
        {offer.description && <p className={`mt-1 text-sm leading-relaxed ${KT.textMuted}`}>{offer.description}</p>}
        <div className="mt-2 flex gap-2">
          {offer.type === "booking" && bookingEnabled && (
            <Button variant="secondary" size="sm" onClick={onBook}>Réserver</Button>
          )}
          {offer.type !== "booking" && commerceEnabled && (
            <Button size="sm" onClick={onAddToCart} className={`${KT.accentBg} ${KT.accentContrastText}`}>
              Ajouter
            </Button>
          )}
        </div>
      </div>
      {/* A dish photo when there is one; a menu row without it stays a clean line of text. */}
      <OfferImage offer={offer} fallback="none" className="h-20 w-20 shrink-0 rounded-xl sm:h-24 sm:w-24" />
    </li>
  );
}

/** "Plats du jour" → "carte-plats-du-jour": a stable in-page anchor for the jump links. */
function categoryAnchor(category: string): string {
  return `carte-${category
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function groupByCategory(offers: PublicOffer[] | undefined): [string, PublicOffer[]][] {
  if (!offers) return [];
  const map = new Map<string, PublicOffer[]>();
  for (const offer of offers) {
    const category = offer.categories[0] || UNCATEGORIZED;
    const list = map.get(category);
    if (list) list.push(offer);
    else map.set(category, [offer]);
  }
  return Array.from(map.entries());
}
