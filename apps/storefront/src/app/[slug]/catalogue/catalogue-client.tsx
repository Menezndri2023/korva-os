"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Pagination, Select } from "@korva/ui";
import { publicApiClient } from "@/lib/public-api-client";
import { useCart } from "@/lib/use-cart";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { resolveStorefrontStyle } from "@/templates/palette";
import { StorefrontThemeStyle } from "@/templates/storefront-theme-style";
import { KT } from "@/templates/kt-classes";
import { BookingPanel, CheckoutPanel } from "../commerce-panels";
import { WishlistButton } from "../wishlist-button";
import { OfferPrice } from "@/templates/sections/OfferPrice";
import { useRouter } from "next/navigation";

const PAGE_SIZE = 24;
const ALL_CATEGORIES = "__all__";

const CATALOGUE_LABELS: Record<string, { title: string; empty: string }> = {
  table: { title: "Notre menu", empty: "Aucun plat ne correspond à votre recherche." },
  academie: { title: "Nos formations", empty: "Aucune formation ne correspond à votre recherche." },
  salon: { title: "Nos services", empty: "Aucun service ne correspond à votre recherche." },
  vitrine: { title: "Nos services", empty: "Aucun service ne correspond à votre recherche." },
  boutique: { title: "Notre boutique", empty: "Aucun produit ne correspond à votre recherche." },
};
const DEFAULT_LABELS = { title: "Notre catalogue", empty: "Aucun article ne correspond à votre recherche." };

/** Debounces the free-text query so every keystroke doesn't fire a new request — 350ms is
 *  short enough to feel live, long enough that a normal typing burst collapses to one call. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export default function CatalogueClient({ slug, nonce }: { slug: string; nonce?: string }) {
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput, 350);
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [sort, setSort] = useState<"newest" | "price_asc" | "price_desc">("newest");
  const [page, setPage] = useState(1);

  // Any filter change restarts pagination at page 1 — staying on e.g. page 3 of a narrowed
  // result set would silently show "no results" instead of the actual first matches. Adjusted
  // during render (React's documented pattern for "resetting state when a prop/input changes"),
  // not in an effect, which would cause an extra visible render with the stale page number.
  const filterKey = `${search}|${category}|${sort}`;
  const [lastFilterKey, setLastFilterKey] = useState(filterKey);
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey);
    setPage(1);
  }

  const orgQuery = useQuery({
    queryKey: ["public-org", slug],
    queryFn: () => publicApiClient.get<PublicOrganization>(`/public/${slug}`),
    retry: false,
  });

  const categoriesQuery = useQuery({
    queryKey: ["public-offer-categories", slug],
    queryFn: () => publicApiClient.get<string[]>(`/public/${slug}/offers/categories`),
    enabled: !!orgQuery.data?.visibleSections.includes("catalog"),
  });

  const searchParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(PAGE_SIZE));
    params.set("sort", sort);
    if (category !== ALL_CATEGORIES) params.set("category", category);
    if (search.trim()) params.set("search", search.trim());
    return params.toString();
  }, [page, sort, category, search]);

  const offersQuery = useQuery({
    queryKey: ["public-offers-search", slug, searchParams],
    queryFn: () => publicApiClient.getList<PublicOffer>(`/public/${slug}/offers/search?${searchParams}`),
    enabled: !!orgQuery.data?.visibleSections.includes("catalog"),
  });

  const { cart, addToCart, clearCart } = useCart(slug);

  const router = useRouter();
  const { hydrated: authHydrated, isAuthenticated, customer } = useCustomerAuth(slug);
  const [bookingOffer, setBookingOffer] = useState<PublicOffer | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  if (orgQuery.isLoading) {
    return <CatalogueSkeleton />;
  }
  if (orgQuery.isError || !orgQuery.data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-app-background text-sm text-text-muted">
        {/* Not "n'existe pas": this branch is reached for any failed load, most often an
            unreachable API, and a real shop's customers must not be told the business is gone.
            See classifyLookupFailure in @/lib/organization-lookup. */}
        <p>Cette boutique est momentanément indisponible.</p>
      </div>
    );
  }

  const organization = orgQuery.data;
  const style = resolveStorefrontStyle(organization.storefrontTheme, organization.brandColor);
  const template = organization.storefrontTheme.template;
  const labels = CATALOGUE_LABELS[template] ?? DEFAULT_LABELS;
  const catalogVisible = organization.visibleSections.includes("catalog");
  const bookingEnabled = organization.visibleSections.includes("booking");
  const commerceEnabled = organization.enabledModules.includes("commerce");
  const result = offersQuery.data;

  return (
    <div className={`min-h-screen ${KT.bg} ${KT.text} ${KT.bodyFont}`}>
      <StorefrontThemeStyle style={style} nonce={nonce} />

      <header className={`border-b ${KT.border} ${KT.surface} px-6 py-4`}>
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href={`/${slug}`} className={`text-lg font-semibold hover:underline ${KT.headingFont}`}>
            {organization.name}
          </Link>
          <div className={`flex items-center gap-4 text-sm ${KT.textMuted}`}>
            <Link href={`/${slug}`} className="hover:underline">Accueil</Link>
            <Link href={`/${slug}/track`} className="hover:underline">Suivre ma commande</Link>
            {authHydrated && (
              <Link href={`/${slug}/account${isAuthenticated ? "" : "/login"}`} className="hover:underline">
                {isAuthenticated ? (customer?.firstName ?? "Mon compte") : "Se connecter"}
              </Link>
            )}
            {commerceEnabled && (
              <Button size="sm" onClick={() => setShowCheckout(true)} disabled={cartCount === 0} className={`${KT.accentBg} ${KT.accentContrastText}`}>
                Panier ({cartCount})
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <h1 className={`mb-6 text-2xl font-semibold ${KT.headingFont}`}>{labels.title}</h1>

        {confirmation && (
          <div className="mb-4 rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-800">{confirmation}</div>
        )}

        {!catalogVisible && <p className={`text-sm ${KT.textMuted}`}>Le catalogue n&apos;est pas disponible pour le moment.</p>}

        {catalogVisible && (
          <>
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Rechercher..."
                aria-label="Rechercher dans le catalogue"
                className="w-full sm:w-64"
              />
              {(categoriesQuery.data?.length ?? 0) > 0 && (
                <Select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  aria-label="Filtrer par catégorie"
                >
                  <option value={ALL_CATEGORIES}>Toutes les catégories</option>
                  {categoriesQuery.data?.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              )}
              <Select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                aria-label="Trier"
              >
                <option value="newest">Plus récents</option>
                <option value="price_asc">Prix croissant</option>
                <option value="price_desc">Prix décroissant</option>
              </Select>
            </div>

            {offersQuery.isLoading && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className={`h-56 animate-pulse rounded-md ${KT.surface}`} />
                ))}
              </div>
            )}

            {offersQuery.isError && (
              <div className={`rounded-md border ${KT.border} p-4 text-sm text-destructive`}>
                Impossible de charger le catalogue.{" "}
                <button onClick={() => offersQuery.refetch()} className="underline">Réessayer</button>
              </div>
            )}

            {result && result.data.length === 0 && (
              <p className={`text-sm ${KT.textMuted}`}>{labels.empty}</p>
            )}

            {result && result.data.length > 0 && (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {result.data.map((offer) => (
                    <CatalogueCard
                      key={offer.id}
                      slug={slug}
                      offer={offer}
                      bookingEnabled={bookingEnabled}
                      commerceEnabled={commerceEnabled}
                      onBook={() => setBookingOffer(offer)}
                      onAddToCart={() =>
                        // Offers with options are chosen on their own page — see storefront-client.
                        offer.optionGroups?.length
                          ? router.push(`/${slug}/offers/${offer.id}`)
                          : addToCart(offer)
                      }
                    />
                  ))}
                </div>

                {result.pagination.totalPages > 1 && (
                  <div className="mt-6">
                    <Pagination page={result.pagination.page} totalPages={result.pagination.totalPages} onPageChange={setPage} disabled={offersQuery.isFetching} />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      {bookingOffer && (
        <BookingPanel
          slug={slug}
          offer={bookingOffer}
          onClose={() => setBookingOffer(null)}
          onSuccess={() => {
            setBookingOffer(null);
            setConfirmation("Votre réservation a bien été enregistrée.");
          }}
        />
      )}

      {showCheckout && (
        <CheckoutPanel
          slug={slug}
          cart={cart}
          currency={organization.currency}
          shippingFlatRate={organization.shippingFlatRate}
          reception={organization}
          acceptedPaymentMethods={organization.acceptedPaymentMethods}
          customer={isAuthenticated && customer ? customer : undefined}
          onClose={() => setShowCheckout(false)}
          onSuccess={(orderNumber) => {
            clearCart();
            setShowCheckout(false);
            setConfirmation(`Commande ${orderNumber} confirmée, merci !`);
            void queryClient.invalidateQueries({ queryKey: ["public-offers-search", slug] });
          }}
        />
      )}
    </div>
  );
}

function CatalogueCard({
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
        {offer.categories.length > 0 && (
          <p className={`text-xs uppercase tracking-wide ${KT.textMuted}`}>{offer.categories[0]}</p>
        )}
        <Link href={`/${slug}/offers/${offer.id}`} className="text-sm font-medium hover:underline">
          {offer.name}
        </Link>
        <p className={`mt-1 text-sm font-semibold ${KT.accentText}`}>
          <OfferPrice offer={offer} />
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

function CatalogueSkeleton() {
  return (
    <div className="min-h-screen bg-app-background">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto max-w-6xl">
          <div className="h-5 w-40 animate-pulse rounded bg-surface-muted" />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-56 animate-pulse rounded-md border border-border bg-surface" />
          ))}
        </div>
      </main>
    </div>
  );
}
