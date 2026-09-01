"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@korva/ui";
import { formatOfferPrice } from "@/lib/offer-labels";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { WishlistButton } from "@/app/[slug]/wishlist-button";
import { KT } from "../kt-classes";
import type { StorefrontTemplateProps } from "../types";

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
  const bookableOffers = (offers ?? []).filter((o) => o.type === "booking");
  const otherOffers = (offers ?? []).filter((o) => o.type !== "booking");
  const heroTextClass = organization.heroImage ? "text-white" : KT.text;
  const heroSubtextClass = organization.heroImage ? "text-zinc-100" : KT.textMuted;

  return (
    <div className={`min-h-screen ${KT.bg} ${KT.text} ${KT.bodyFont}`}>
      <div className="relative flex h-72 flex-col items-center justify-center overflow-hidden text-center sm:h-96">
        {organization.heroImage ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={organization.heroImage} alt="" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-black/40" />
          </>
        ) : (
          <div className={`absolute inset-0 ${KT.surface}`} />
        )}
        <div className="relative z-10 flex flex-col items-center gap-4 px-6">
          <Logo organization={organization} />
          <h1 className={`text-3xl font-semibold sm:text-4xl ${KT.headingFont} ${heroTextClass}`}>{organization.name}</h1>
          {organization.tagline && <p className={`max-w-md text-sm ${heroSubtextClass}`}>{organization.tagline}</p>}
          {bookingEnabled && bookableOffers.length > 0 && (
            <a
              href="#services"
              className={`mt-2 inline-flex rounded-full px-5 py-2 text-sm font-semibold ${KT.accentBg} ${KT.accentContrastText}`}
            >
              Réserver maintenant
            </a>
          )}
        </div>
      </div>

      <header className={`border-b ${KT.border} ${KT.surface} px-6 py-3`}>
        <div className="mx-auto flex max-w-3xl items-center justify-between text-sm">
          <div className={`flex items-center gap-4 ${KT.textMuted}`}>
            <Link href={`/${slug}/track`} className="hover:underline">Suivre ma réservation</Link>
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

      <main id="services" className="mx-auto max-w-3xl space-y-8 px-6 py-10">
        {confirmation && (
          <div className="rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800">{confirmation}</div>
        )}

        {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>Aucune prestation disponible pour le moment.</p>}

        {catalogVisible && offersLoading && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`h-16 animate-pulse rounded-lg ${KT.surface}`} />
            ))}
          </div>
        )}

        {catalogVisible && offersError && (
          <div className={`rounded-md border ${KT.border} p-4 text-sm text-destructive`}>
            Impossible de charger les prestations.{" "}
            <button onClick={onRetryOffers} className="underline">Réessayer</button>
          </div>
        )}

        {catalogVisible && offers && offers.length === 0 && (
          <p className={`text-sm ${KT.textMuted}`}>Les prestations seront bientôt publiées.</p>
        )}

        {catalogVisible && bookableOffers.length > 0 && (
          <section>
            <h2 className={`text-lg font-semibold ${KT.headingFont}`}>Nos prestations</h2>
            <ul className="mt-3 space-y-3">
              {bookableOffers.map((offer) => (
                <ServiceCard key={offer.id} slug={slug} offer={offer} primary onBook={() => onBook(offer)} />
              ))}
            </ul>
          </section>
        )}

        {catalogVisible && commerceEnabled && otherOffers.length > 0 && (
          <section>
            <h2 className={`text-lg font-semibold ${KT.headingFont}`}>Nos produits</h2>
            <ul className="mt-3 space-y-3">
              {otherOffers.map((offer) => (
                <ServiceCard key={offer.id} slug={slug} offer={offer} onAddToCart={() => onAddToCart(offer)} />
              ))}
            </ul>
          </section>
        )}
      </main>
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
    <li className={`flex items-center justify-between gap-4 rounded-lg border p-4 ${KT.border} ${KT.surface}`}>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Link href={`/${slug}/offers/${offer.id}`} className="font-medium hover:underline">{offer.name}</Link>
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
        {offer.description && <p className={`mt-1 text-sm ${KT.textMuted}`}>{offer.description}</p>}
        <p className="mt-1 text-sm font-medium">{formatOfferPrice(offer.pricing.amount, offer.pricing.currency)}</p>
      </div>
      {primary && onBook && (
        <Button onClick={onBook} className={`${KT.accentBg} ${KT.accentContrastText}`}>
          Réserver
        </Button>
      )}
      {!primary && onAddToCart && (
        <Button variant="secondary" onClick={onAddToCart}>Ajouter</Button>
      )}
    </li>
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
      className="h-12 w-12 rounded-full bg-white object-contain p-1"
    />
  );
}
