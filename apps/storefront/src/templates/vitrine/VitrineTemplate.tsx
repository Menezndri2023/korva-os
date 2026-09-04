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

/**
 * Services vitrine — professional services, trades/construction, real estate, digital
 * agencies, associations, events. Reads as a corporate/consultant site: a statement headline
 * hero, then services presented as a numbered list rather than a product grid, and a closing
 * contact strip instead of a shopping-oriented footer.
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
  return (
    <div className={`min-h-screen ${KT.bg} ${KT.text} ${KT.bodyFont}`}>
      <header className={`border-b ${KT.border} px-6 py-5`}>
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo organization={organization} />
            <span className={`text-base font-semibold tracking-tight ${KT.headingFont}`}>{organization.name}</span>
          </div>
          <nav className={`flex items-center gap-5 text-sm ${KT.textMuted}`}>
            <a href="#services" className="hover:underline">Services</a>
            {catalogVisible && (
              <Link href={`/${slug}/catalogue`} className="hover:underline">Tous nos services</Link>
            )}
            <Link href={`/${slug}/track`} className="hover:underline">Suivi</Link>
            {authHydrated && (
              <Link href={`/${slug}/account${isAuthenticated ? "" : "/login"}`} className="hover:underline">
                {isAuthenticated ? (customerFirstName ?? "Mon compte") : "Se connecter"}
              </Link>
            )}
            {commerceEnabled && cartCount > 0 && (
              <Button size="sm" onClick={onOpenCheckout} className={`${KT.accentBg} ${KT.accentContrastText}`}>
                Panier ({cartCount})
              </Button>
            )}
          </nav>
        </div>
      </header>

      <section className={`px-6 py-16 ${KT.surface}`}>
        <div className="mx-auto grid max-w-5xl gap-8 sm:grid-cols-[1.2fr_1fr] sm:items-center">
          <div>
            <h1 className={`text-3xl font-semibold leading-tight sm:text-4xl ${KT.headingFont}`}>
              {organization.tagline || organization.name}
            </h1>
            <p className={`mt-4 text-sm ${KT.textMuted}`}>
              {organization.name} accompagne ses clients avec des prestations sur mesure.
            </p>
            <a
              href="#services"
              className={`mt-6 inline-flex rounded-md px-4 py-2 text-sm font-medium ${KT.accentBg} ${KT.accentContrastText}`}
            >
              Découvrir nos services
            </a>
          </div>
          {organization.heroImage && <HeroImage src={organization.heroImage} />}
        </div>
      </section>

      <main id="services" className="mx-auto max-w-5xl space-y-4 px-6 py-14">
        <h2 className={`text-xl font-semibold ${KT.headingFont}`}>Nos services</h2>

        {confirmation && (
          <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800">
            {confirmation}
          </div>
        )}

        {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>Aucun service disponible pour le moment.</p>}

        {catalogVisible && offersLoading && <ListSkeleton />}

        {catalogVisible && offersError && (
          <div className={`rounded-md border ${KT.border} p-4 text-sm text-destructive`}>
            Impossible de charger les services.{" "}
            <button onClick={onRetryOffers} className="underline">Réessayer</button>
          </div>
        )}

        {catalogVisible && offers && offers.length === 0 && (
          <p className={`text-sm ${KT.textMuted}`}>Aucun service publié pour le moment.</p>
        )}

        {catalogVisible && offers && offers.length > 0 && (
          <ul className={`divide-y ${KT.border}`}>
            {offers.map((offer, index) => (
              <ServiceRow
                key={offer.id}
                index={index + 1}
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
      <TestimonialsSection organization={organization} />
      <FaqSection organization={organization} />

      <footer className={`border-t ${KT.border} px-6 py-8 text-sm ${KT.textMuted}`}>
        <div className="mx-auto max-w-5xl">
          <p className={`font-medium ${KT.text} ${KT.headingFont}`}>{organization.name}</p>
          {organization.tagline && <p className="mt-1">{organization.tagline}</p>}
        </div>
      </footer>
    </div>
  );
}

function ServiceRow({
  index,
  slug,
  offer,
  bookingEnabled,
  commerceEnabled,
  onBook,
  onAddToCart,
}: {
  index: number;
  slug: string;
  offer: PublicOffer;
  bookingEnabled: boolean;
  commerceEnabled: boolean;
  onBook: () => void;
  onAddToCart: () => void;
}) {
  return (
    <li className={`flex flex-col gap-3 py-6 sm:flex-row sm:items-start sm:gap-6 ${KT.border}`}>
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${KT.accentBg} ${KT.accentContrastText}`}
      >
        {String(index).padStart(2, "0")}
      </span>
      <div className="flex-1">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/${slug}/offers/${offer.id}`} className={`font-medium hover:underline ${KT.headingFont}`}>
            {offer.name}
          </Link>
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
        <p className={`mt-1 text-xs uppercase tracking-wide ${KT.textMuted}`}>{OFFER_TYPE_LABELS[offer.type]}</p>
        {offer.description && <p className={`mt-2 text-sm ${KT.textMuted}`}>{offer.description}</p>}
        <div className="mt-3 flex items-center gap-3">
          <span className="text-sm font-medium">{formatOfferPrice(offer.pricing.amount, offer.pricing.currency)}</span>
          {offer.type === "booking" && bookingEnabled && (
            <Button variant="secondary" size="sm" onClick={onBook}>Réserver</Button>
          )}
          {offer.type !== "booking" && commerceEnabled && (
            <Button variant="secondary" size="sm" onClick={onAddToCart}>Ajouter au panier</Button>
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
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`h-56 w-full rounded-lg border object-cover ${KT.border}`}
    />
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

function ListSkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`h-16 animate-pulse rounded-md ${KT.surface}`} />
      ))}
    </div>
  );
}
