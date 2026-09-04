"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Button } from "@korva/ui";
import { formatOfferPrice } from "@/lib/offer-labels";
import type { PublicOffer } from "@/lib/public-types";
import { WishlistButton } from "@/app/[slug]/wishlist-button";
import { KT } from "../kt-classes";
import type { StorefrontTemplateProps } from "../types";
import { AboutSection } from "../sections/AboutSection";
import { TeamSection } from "../sections/TeamSection";
import { GallerySection } from "../sections/GallerySection";
import { TestimonialsSection } from "../sections/TestimonialsSection";
import { FaqSection } from "../sections/FaqSection";

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
  const heroTextClass = organization.heroImage ? "text-white" : KT.text;
  const heroSubtextClass = organization.heroImage ? "text-zinc-100" : KT.textMuted;

  return (
    <div className={`min-h-screen ${KT.bg} ${KT.text} ${KT.bodyFont}`}>
      <div className="relative flex h-72 flex-col items-center justify-center overflow-hidden text-center sm:h-96">
        {organization.heroImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={organization.heroImage} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />
          </>
        ) : (
          <div className={`absolute inset-0 ${KT.surface}`} />
        )}
        <div className="relative z-10 px-6">
          <h1 className={`text-4xl font-semibold sm:text-5xl ${KT.headingFont} ${heroTextClass}`}>{organization.name}</h1>
          {organization.tagline && (
            <p className={`mt-3 text-base sm:text-lg ${heroSubtextClass}`}>{organization.tagline}</p>
          )}
        </div>
      </div>

      <header className={`border-b ${KT.border} ${KT.surface} px-6 py-3`}>
        <div className="mx-auto flex max-w-3xl items-center justify-between text-sm">
          <div className={`flex items-center gap-4 ${KT.textMuted}`}>
            {catalogVisible && (
              <Link href={`/${slug}/catalogue`} className="hover:underline">Menu complet</Link>
            )}
            <Link href={`/${slug}/track`} className="hover:underline">Suivre ma commande</Link>
            {authHydrated && (
              <Link href={`/${slug}/account${isAuthenticated ? "" : "/login"}`} className="hover:underline">
                {isAuthenticated ? (customerFirstName ?? "Mon compte") : "Se connecter"}
              </Link>
            )}
          </div>
          {commerceEnabled && cartCount > 0 && (
            <Button size="sm" onClick={onOpenCheckout} className={`${KT.accentBg} ${KT.accentContrastText}`}>
              Panier ({cartCount})
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-8 px-6 py-10">
        {confirmation && (
          <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800">{confirmation}</div>
        )}

        {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>La carte n&apos;est pas disponible pour le moment.</p>}

        {catalogVisible && offersLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-14 animate-pulse rounded-md ${KT.surface}`} />
            ))}
          </div>
        )}

        {catalogVisible && offersError && (
          <div className={`rounded-md border ${KT.border} p-4 text-sm text-destructive`}>
            Impossible de charger la carte.{" "}
            <button onClick={onRetryOffers} className="underline">Réessayer</button>
          </div>
        )}

        {catalogVisible && offers && offers.length === 0 && (
          <p className={`text-sm ${KT.textMuted}`}>La carte sera bientôt disponible.</p>
        )}

        {catalogVisible &&
          groups.map(([category, items]) => (
            <section key={category}>
              <h2
                className={`border-b-2 pb-3 text-xl font-semibold uppercase tracking-wide ${KT.borderAccent} ${KT.text} ${KT.headingFont}`}
              >
                {category}
              </h2>
              <ul className={`mt-3 divide-y ${KT.border}`}>
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
      <TestimonialsSection organization={organization} />
      <FaqSection organization={organization} />
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
    <li className="flex items-start justify-between gap-4 py-3">
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/${slug}/offers/${offer.id}`} className="font-medium hover:underline">
            {offer.name}
          </Link>
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
        {offer.description && <p className={`mt-1 text-sm ${KT.textMuted}`}>{offer.description}</p>}
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
      <span className={`whitespace-nowrap text-base font-semibold ${KT.accentText}`}>
        {formatOfferPrice(offer.pricing.amount, offer.pricing.currency)}
      </span>
    </li>
  );
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
