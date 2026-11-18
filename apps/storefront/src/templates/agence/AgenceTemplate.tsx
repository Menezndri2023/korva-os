"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
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
import { TeamSection } from "../sections/TeamSection";
import { CustomerReviewsSection } from "../sections/CustomerReviews";
import { TestimonialsSection } from "../sections/TestimonialsSection";
import { FaqSection } from "../sections/FaqSection";
import { SectionHeading } from "../sections/SectionHeading";
import { OfferPrice } from "@/templates/sections/OfferPrice";
import { OfferImage } from "../sections/OfferImage";
import { SiteHeader, siteLinks } from "../sections/SiteHeader";
import { SiteFooter } from "../sections/SiteFooter";
import { siteWording } from "../wording";
import { Confirmation } from "../sections/Confirmation";
import {
  filterListings,
  listingChoices,
  NO_LISTING_FILTERS,
  optionLabel,
  placeOf,
  propertyFacts,
  type ListingFilters,
  type Transaction,
} from "../sections/listing-facts";
import { useStorefrontLocale, useT } from "@/lib/storefront-locale";

/**
 * Estate agencies and letting managers. Used to borrow "vitrine", which shows two large service
 * cards a row and no way to narrow them down: a property seeker looks for "a flat to let in
 * Cocody under 300 000". Listings are cards with transaction, type, surface, rooms and place,
 * above a filter bar built only from what the agency's listings contain. The agency's bookable
 * services (an estimate, a viewing slot) follow the listings.
 */
export function AgenceTemplate({
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
  cartCount,
  onOpenCheckout,
  confirmation,
  authHydrated,
  isAuthenticated,
  customerFirstName,
}: StorefrontTemplateProps) {
  const locale = useStorefrontLocale();
  const t = useT();
  const words = siteWording(organization.businessModel, {
    catalogLink: t("Tous nos biens", "All our properties"),
    eyebrow: t("À vendre et à louer", "For sale and to let"),
    title: t("Nos biens", "Our properties"),
    heroCta: t("Voir nos biens", "See our properties"),
    book: t("Demander une visite", "Ask for a viewing"),
  }, locale);
  const links = siteLinks(slug, catalogVisible, { catalog: words.catalogLink, track: t("Suivi", "Tracking") });

  const listings = useMemo(() => (offers ?? []).filter((o) => o.type !== "booking"), [offers]);
  const services = (offers ?? []).filter((o) => o.type === "booking");
  const choices = useMemo(() => listingChoices(listings), [listings]);
  const [filters, setFilters] = useState<ListingFilters>(NO_LISTING_FILTERS);
  const shown = filterListings(listings, filters);
  const filtered = shown.length !== listings.length;

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

      <section className={`px-4 py-12 sm:px-6 sm:py-16 ${KT.surface}`}>
        <div className="mx-auto grid max-w-6xl gap-8 sm:grid-cols-[1.1fr_1fr] sm:items-center">
          <div>
            <h1 className={`text-4xl font-semibold leading-tight sm:text-5xl ${KT.headingFont}`}>
              {organization.tagline || organization.name}
            </h1>
            <p className={`mt-4 max-w-md text-lg ${KT.textMuted}`}>
              {organization.tagline ? organization.name : siteSubtitle(organization, t)}
            </p>
            {listings.length > 0 && (
              <a
                href="#biens"
                className={`mt-7 inline-flex rounded-full px-6 py-3 text-sm font-semibold shadow-md transition-shadow hover:shadow-lg ${KT.accentBg} ${KT.accentContrastText}`}
              >
                {words.heroCta}
                <span className="ml-2 opacity-80">({listings.length})</span>
              </a>
            )}
          </div>
          {organization.heroImage && (
            <HeroSlides
              images={heroImagesOf(organization)}
              className={`h-60 w-full rounded-3xl border shadow-lg sm:h-80 ${KT.border}`}
            />
          )}
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-4 pt-10 sm:px-6">
        <PracticalInfo organization={organization} commerceEnabled={commerceEnabled} bookingEnabled={bookingEnabled} />
      </div>

      <main id="biens" className="mx-auto w-full max-w-6xl scroll-mt-20 space-y-14 px-4 py-12 sm:px-6 sm:py-14">
        <section>
          <SectionHeading eyebrow={words.eyebrow} title={words.title} />
          <Confirmation message={confirmation} />

          {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>{t(
            "Aucun bien disponible pour le moment.",
            "No properties available yet.",
          )}</p>}

          {catalogVisible && offersLoading && (
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className={`h-80 animate-pulse rounded-2xl ${KT.surface}`} />
              ))}
            </div>
          )}

          {catalogVisible && offersError && (
            <div className={`rounded-2xl border ${KT.border} p-4 text-sm text-destructive`}>
              {t("Impossible de charger les biens.", "The properties could not be loaded.")}{" "}
              <button onClick={onRetryOffers} className="underline">{t("Réessayer", "Try again")}</button>
            </div>
          )}

          {catalogVisible && offers && listings.length === 0 && (
            <p className={`text-sm ${KT.textMuted}`}>{t(
              "Nos biens seront bientôt publiés.",
              "Our properties will be published soon.",
            )}</p>
          )}

          {catalogVisible && listings.length > 0 && (
            <>
              <FilterBar
                choices={choices}
                filters={filters}
                onChange={setFilters}
                currency={listings[0]?.pricing.currency}
              />
              <p className={`mb-4 text-sm ${KT.textMuted}`} aria-live="polite">
                {shown.length === 0
                  ? t("Aucun bien ne correspond à ces critères.", "No property matches these criteria.")
                  : shown.length === 1
                    ? t("1 bien", "1 property")
                    : t(`${shown.length} biens`, `${shown.length} properties`)}
                {filtered && (
                  <button
                    type="button"
                    onClick={() => setFilters(NO_LISTING_FILTERS)}
                    className={`ml-3 font-medium underline-offset-2 hover:underline ${KT.accentText}`}
                  >
                    {t("Effacer les filtres", "Clear filters")}
                  </button>
                )}
              </p>
              <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((offer) => (
                  <ListingCard key={offer.id} slug={slug} offer={offer} visitLabel={words.book} />
                ))}
              </ul>
            </>
          )}
        </section>

        {catalogVisible && services.length > 0 && (
          <section>
            <SectionHeading eyebrow={t("Sur rendez-vous", "By appointment")} title={t("Nos services", "Our services")} />
            <ul className={`divide-y rounded-2xl border ${KT.border} ${KT.surface}`}>
              {services.map((offer) => (
                <li key={offer.id} className={`flex items-center justify-between gap-4 p-4 ${KT.border}`}>
                  <div className="min-w-0">
                    <Link href={`/${slug}/offers/${offer.id}`} className="font-medium hover:underline">{offer.name}</Link>
                    {offer.description && <p className={`line-clamp-1 text-sm ${KT.textMuted}`}>{offer.description}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold"><OfferPrice offer={offer} /></span>
                    {bookingEnabled && (
                      <Button size="sm" onClick={() => onBook(offer)} className={`${KT.accentBg} ${KT.accentContrastText}`}>
                        {t("Réserver", "Book")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      <AboutSection organization={organization} />
      <TeamSection organization={organization} />
      <CustomerReviewsSection organization={organization} />
      <TestimonialsSection organization={organization} />
      <FaqSection organization={organization} />
      <SiteFooter organization={organization} links={links} />
    </div>
  );
}

function optionalNumber(value: string): number | undefined {
  const n = Number(value.replace(/\s/g, ""));
  return value.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
}

function FilterBar({
  choices,
  filters,
  onChange,
  currency,
}: {
  choices: ReturnType<typeof listingChoices>;
  filters: ListingFilters;
  onChange: (filters: ListingFilters) => void;
  currency?: string;
}) {
  const locale = useStorefrontLocale();
  const t = useT();
  const field = `w-full rounded-xl border bg-transparent px-3 py-2 text-sm ${KT.border}`;
  const label = `mb-1 block text-xs font-medium ${KT.textMuted}`;
  const transactionLabel = (value: Transaction) =>
    value === "sale" ? t("Vente", "For sale") : t("Location", "To let");

  return (
    <form
      role="search"
      aria-label={t("Rechercher un bien", "Search properties")}
      onSubmit={(event) => event.preventDefault()}
      className={`mb-5 grid gap-3 rounded-2xl border p-4 sm:grid-cols-3 lg:grid-cols-5 ${KT.border} ${KT.surface}`}
    >
      {choices.transactions.length > 1 && (
        <label>
          <span className={label}>{t("Transaction", "Transaction")}</span>
          <select
            className={field}
            value={filters.transaction}
            onChange={(e) => onChange({ ...filters, transaction: e.target.value as ListingFilters["transaction"] })}
          >
            <option value="all">{t("Vente et location", "Sale and rent")}</option>
            {choices.transactions.map((value) => (
              <option key={value} value={value}>{transactionLabel(value)}</option>
            ))}
          </select>
        </label>
      )}
      {choices.kinds.length > 1 && (
        <label>
          <span className={label}>{t("Type de bien", "Property type")}</span>
          <select className={field} value={filters.kind} onChange={(e) => onChange({ ...filters, kind: e.target.value })}>
            <option value="all">{t("Tous", "All")}</option>
            {choices.kinds.map((value) => (
              <option key={value} value={value}>{optionLabel(value, locale)}</option>
            ))}
          </select>
        </label>
      )}
      {choices.places.length > 1 && (
        <label>
          <span className={label}>{t("Quartier ou ville", "District or city")}</span>
          <select className={field} value={filters.place} onChange={(e) => onChange({ ...filters, place: e.target.value })}>
            <option value="all">{t("Partout", "Anywhere")}</option>
            {choices.places.map((value) => (
              <option key={value} value={value}>{value}</option>
            ))}
          </select>
        </label>
      )}
      <label>
        <span className={label}>
          {t("Prix maximum", "Maximum price")}{currency ? ` (${currency})` : ""}
        </span>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          className={field}
          value={filters.maxPrice ?? ""}
          onChange={(e) => onChange({ ...filters, maxPrice: optionalNumber(e.target.value) })}
        />
      </label>
      <label>
        <span className={label}>{t("Surface minimum (m²)", "Minimum surface (m²)")}</span>
        <input
          type="number"
          inputMode="numeric"
          min="0"
          className={field}
          value={filters.minSurface ?? ""}
          onChange={(e) => onChange({ ...filters, minSurface: optionalNumber(e.target.value) })}
        />
      </label>
    </form>
  );
}

function ListingCard({ slug, offer, visitLabel }: { slug: string; offer: PublicOffer; visitLabel: string }) {
  const locale = useStorefrontLocale();
  const t = useT();
  const facts = propertyFacts(offer);
  const place = placeOf(facts);
  const details = [
    facts.surface ? `${facts.surface} m²` : null,
    facts.rooms ? t(`${facts.rooms} pièce${facts.rooms > 1 ? "s" : ""}`, `${facts.rooms} room${facts.rooms > 1 ? "s" : ""}`) : null,
    facts.bedrooms
      ? t(`${facts.bedrooms} chambre${facts.bedrooms > 1 ? "s" : ""}`, `${facts.bedrooms} bedroom${facts.bedrooms > 1 ? "s" : ""}`)
      : null,
  ].filter((detail): detail is string => Boolean(detail));

  return (
    <li className={`group flex flex-col overflow-hidden rounded-2xl border transition-shadow duration-200 hover:shadow-lg ${KT.border} ${KT.surface}`}>
      <Link href={`/${slug}/offers/${offer.id}`} tabIndex={-1} aria-hidden className="relative">
        <OfferImage offer={offer} zoomOnHover className="aspect-[4/3] w-full" />
        {facts.transaction && (
          <span className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-semibold shadow ${KT.accentBg} ${KT.accentContrastText}`}>
            {facts.transaction === "sale" ? t("À vendre", "For sale") : t("À louer", "To let")}
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <p className="text-lg font-semibold">
          <OfferPrice offer={offer} />
          {facts.transaction === "rent" && <span className={`text-sm font-normal ${KT.textMuted}`}> {t("/ mois", "/ month")}</span>}
        </p>
        <div className="mt-1 flex items-start justify-between gap-2">
          <Link href={`/${slug}/offers/${offer.id}`} className={`font-medium hover:underline ${KT.headingFont}`}>
            <FeaturedBadge offer={offer} />{offer.name}
          </Link>
          <WishlistButton slug={slug} offerId={offer.id} />
        </div>
        {(facts.kind || details.length > 0) && (
          <p className={`mt-1 text-sm ${KT.textMuted}`}>
            {[facts.kind ? optionLabel(facts.kind, locale) : null, ...details].filter(Boolean).join(" · ")}
          </p>
        )}
        {place && <p className={`mt-0.5 text-sm ${KT.textMuted}`}>{place}</p>}
        <Link
          href={`/${slug}/offers/${offer.id}`}
          className={`mt-auto pt-4 text-sm font-medium underline-offset-2 hover:underline ${KT.accentText}`}
        >
          {visitLabel} →
        </Link>
      </div>
    </li>
  );
}
