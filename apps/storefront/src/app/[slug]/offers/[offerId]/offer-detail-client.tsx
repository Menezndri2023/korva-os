"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card } from "@korva/ui";
import { PublicApiError, publicApiClient } from "@/lib/public-api-client";
import { useCart } from "@/lib/use-cart";
import { OFFER_TYPE_LABELS, formatOfferPrice } from "@/lib/offer-labels";
import type { PublicOffer, PublicOfferReviewSummary, PublicOrganization } from "@/lib/public-types";
import { BookingPanel, CheckoutPanel } from "../../lazy-commerce-panels";
import { OfferPrice } from "@/templates/sections/OfferPrice";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import { resolveStorefrontStyle } from "@/templates/palette";
import { StorefrontThemeStyle } from "@/templates/storefront-theme-style";
import { KT } from "@/templates/kt-classes";
import { SiteHeader, siteLinks } from "@/templates/sections/SiteHeader";
import { SiteFooter } from "@/templates/sections/SiteFooter";
import { MobileCartBar } from "@/templates/sections/MobileCartBar";
import { WhatsAppButton } from "@/templates/sections/WhatsAppButton";
import { whatsappLink } from "@/lib/contact";
import { MessageCircle } from "lucide-react";
import { Confirmation } from "@/templates/sections/Confirmation";
import {
  missingRequiredGroups,
  OfferOptionsPicker,
  summarizeOptions,
} from "@/templates/sections/OfferOptionsPicker";

export default function OfferDetailClient({
  slug,
  offerId,
  nonce,
}: {
  slug: string;
  offerId: string;
  nonce?: string;
}) {
  const queryClient = useQueryClient();

  const orgQuery = useQuery({
    queryKey: ["public-org", slug],
    queryFn: () => publicApiClient.get<PublicOrganization>(`/public/${slug}`),
    retry: false,
  });
  // A dedicated single-offer lookup (not a client-side .find() over the homepage's capped
  // 50-item preview list) — an offer beyond that cap must still have a working detail page.
  const offerQuery = useQuery({
    queryKey: ["public-offer", slug, offerId],
    queryFn: () => publicApiClient.get<PublicOffer>(`/public/${slug}/offers/${offerId}`),
    enabled: !!orgQuery.data?.enabledModules.includes("catalog"),
    retry: false,
  });

  const { cart, addToCart, clearCart } = useCart(slug);
  const { hydrated: authHydrated, isAuthenticated, customer } = useCustomerAuth(slug);
  const [showBooking, setShowBooking] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);

  if (orgQuery.isLoading || (orgQuery.data && offerQuery.isLoading)) {
    return <DetailSkeleton slug={slug} />;
  }
  if (orgQuery.isError || !orgQuery.data) {
    return (
      <CenteredMessage>
        <p>Cette boutique n&apos;existe pas.</p>
        <button onClick={() => orgQuery.refetch()} className="mt-2 text-sm font-medium underline">
          Réessayer
        </button>
      </CenteredMessage>
    );
  }
  const organization = orgQuery.data;

  if (!organization.enabledModules.includes("catalog")) {
    return (
      <CenteredMessage>
        <p>Aucun catalogue disponible pour cette boutique.</p>
        <BackLink slug={slug} />
      </CenteredMessage>
    );
  }

  if (offerQuery.isError) {
    const isNotFound =
      offerQuery.error instanceof PublicApiError && offerQuery.error.code === "OFFER_NOT_FOUND";
    if (isNotFound) {
      return (
        <CenteredMessage>
          <p>Cette offre n&apos;existe pas ou n&apos;est plus disponible.</p>
          <BackLink slug={slug} />
        </CenteredMessage>
      );
    }
    return (
      <CenteredMessage>
        <p>Impossible de charger cette offre.</p>
        <button onClick={() => offerQuery.refetch()} className="mt-2 text-sm font-medium underline">
          Réessayer
        </button>
      </CenteredMessage>
    );
  }

  const offer = offerQuery.data;
  if (!offer) {
    return (
      <CenteredMessage>
        <p>Cette offre n&apos;existe pas ou n&apos;est plus disponible.</p>
        <BackLink slug={slug} />
      </CenteredMessage>
    );
  }

  const bookingEnabled = organization.enabledModules.includes("booking");
  const commerceEnabled = organization.enabledModules.includes("commerce");
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const images = offer.images;
  const selectedVariant =
    offer.variants.find((v) => v.id === selectedVariantId) ?? offer.variants[0];
  const optionGroups = offer.optionGroups ?? [];
  const missingOptions = missingRequiredGroups(optionGroups, selectedOptionIds);

  // The offer page wears the shop's theme like its home page — it is the page a link shared on
  // WhatsApp opens, and it used to be the one page of the site in neutral grey.
  const style = resolveStorefrontStyle(organization.storefrontTheme, organization.brandColor);
  const links = siteLinks(slug, organization.visibleSections.includes("catalog"), {
    catalog: "Catalogue complet",
    track: "Suivre ma commande",
  });
  const activeSrc = images[activeImage];

  return (
    <div className={`flex min-h-screen flex-col ${KT.bg} ${KT.text} ${KT.bodyFont}`}>
      <StorefrontThemeStyle style={style} nonce={nonce} />
      <SiteHeader
        slug={slug}
        organization={organization}
        links={links}
        authHydrated={authHydrated}
        isAuthenticated={isAuthenticated}
        customerFirstName={customer?.firstName}
        commerceEnabled={commerceEnabled}
        cartCount={cartCount}
        onOpenCheckout={() => setShowCheckout(true)}
      />

      <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        <BackLink slug={slug} />
        <Confirmation message={confirmation} />

        <div className="grid gap-6 md:grid-cols-2 md:gap-10">
          <div>
            {activeSrc && !imageFailed ? (
              <>
                <div className={`overflow-hidden rounded-3xl ${KT.accentSoftBg}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary tenant-supplied
                      host, not one of Next's configured image domains (see middleware.ts img-src). */}
                  <img
                    src={activeSrc}
                    alt={offer.name}
                    fetchPriority="high"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    onError={() => setImageFailed(true)}
                    className="aspect-square w-full object-cover"
                  />
                </div>
                {images.length > 1 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {images.map((image, index) => (
                      <button
                        key={image + String(index)}
                        onClick={() => setActiveImage(index)}
                        aria-label={`Image ${index + 1} sur ${images.length}`}
                        aria-current={index === activeImage}
                        className={`h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl border-2 ${
                          index === activeImage ? KT.borderAccent : "border-transparent"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                        <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div
                aria-hidden
                className={`flex aspect-square w-full items-center justify-center rounded-3xl ${KT.accentSoftBg} ${KT.accentText}`}
              >
                <span className={`text-7xl font-semibold opacity-60 ${KT.headingFont}`}>
                  {offer.name.trim().charAt(0).toUpperCase()}
                </span>
              </div>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{OFFER_TYPE_LABELS[offer.type]}</Badge>
              {offer.categories.map((category) => (
                <Badge key={category} variant="default">
                  {category}
                </Badge>
              ))}
            </div>
            <h1 className={`mt-3 text-3xl font-semibold leading-tight sm:text-4xl ${KT.headingFont}`}>{offer.name}</h1>

            <p className={`mt-3 text-2xl font-semibold ${KT.accentText}`}>
              <OfferPrice offer={offer} />
              {offer.pricing.taxRate != null && (
                <span className={`ml-1 text-sm font-normal ${KT.textMuted}`}>
                  (TVA {offer.pricing.taxRate}%)
                </span>
              )}
            </p>

            {offer.description && (
              <p className={`mt-4 whitespace-pre-line text-base leading-relaxed ${KT.textMuted}`}>{offer.description}</p>
            )}

            {offer.attributes && Object.keys(offer.attributes).length > 0 && (
              <dl className={`mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-2xl border p-4 text-sm ${KT.border} ${KT.surface}`}>
                {Object.entries(offer.attributes).map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className={KT.textMuted}>{key}</dt>
                    <dd className="font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {optionGroups.length > 0 && offer.type !== "booking" && commerceEnabled && (
              <OfferOptionsPicker
                groups={optionGroups}
                selected={selectedOptionIds}
                onChange={setSelectedOptionIds}
                currency={offer.pricing.currency}
              />
            )}

            {offer.variants.length > 0 && (
              <div className="mt-6">
                <h2 className="text-sm font-medium">Variantes</h2>
                <Card className="mt-2 overflow-hidden">
                  {/* Separate scroll container from Card's own overflow-hidden (which exists only
                      to clip content to the rounded corners, per packages/ui/src/card/card.tsx) —
                      without it, a variant/SKU too wide for the viewport would be silently cut off
                      on narrow screens instead of reachable via horizontal scroll. */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border bg-surface-muted text-left text-xs font-medium text-text-muted">
                        <tr>
                          {commerceEnabled && offer.type !== "booking" && (
                            <th className="px-3 py-2" aria-hidden />
                          )}
                          <th className="px-3 py-2">Variante</th>
                          <th className="px-3 py-2">SKU</th>
                          <th className="px-3 py-2">Prix</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {offer.variants.map((variant, index) => (
                          <tr key={variant.id}>
                            {commerceEnabled && offer.type !== "booking" && (
                              <td className="px-3 py-2">
                                <input
                                  type="radio"
                                  name="variant"
                                  aria-label={`Choisir ${variant.name}`}
                                  checked={
                                    selectedVariantId
                                      ? selectedVariantId === variant.id
                                      : index === 0
                                  }
                                  onChange={() => setSelectedVariantId(variant.id)}
                                />
                              </td>
                            )}
                            <td className="whitespace-nowrap px-3 py-2 font-medium text-text">
                              {variant.name}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-text-muted">
                              {variant.sku ?? "—"}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-text-muted">
                              {variant.priceOverride != null
                                ? formatOfferPrice(variant.priceOverride, offer.pricing.currency)
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            )}

            <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:items-center">
              {offer.type === "booking" && bookingEnabled && (
                <Button size="lg" className={`w-full sm:w-auto ${KT.accentBg} ${KT.accentContrastText}`} onClick={() => setShowBooking(true)}>
                  Réserver
                </Button>
              )}
              {offer.type !== "booking" && commerceEnabled && (
                <Button
                  size="lg"
                  className={`w-full sm:w-auto ${KT.accentBg} ${KT.accentContrastText}`}
                  disabled={missingOptions.length > 0}
                  onClick={() => {
                    addToCart(
                      offer,
                      selectedVariant,
                      summarizeOptions(optionGroups, selectedOptionIds),
                    );
                    setSelectedOptionIds([]);
                  }}
                >
                  Ajouter au panier
                </Button>
              )}
              {organization.whatsappNumber && (
                // Built on click, not at render: the message carries this page's address, and
                // `window` does not exist during the server render.
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    const price = formatOfferPrice(offer.pricing.amount, offer.pricing.currency);
                    window.open(
                      whatsappLink(
                        organization.whatsappNumber!,
                        `Bonjour ${organization.name}, je suis intéressé(e) par « ${offer.name} » (${price}) : ${window.location.href}`,
                      ),
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                >
                  <MessageCircle aria-hidden className="h-5 w-5" />
                  {offer.type === "booking" ? "Demander sur WhatsApp" : "Commander sur WhatsApp"}
                </Button>
              )}
              {missingOptions.length > 0 && offer.type !== "booking" && commerceEnabled && (
                <p className={`text-sm ${KT.textMuted}`}>À choisir : {missingOptions.join(", ")}</p>
              )}
            </div>
          </div>
        </div>

        <OfferReviews slug={slug} offerId={offerId} />
      </main>

      <SiteFooter organization={organization} links={links} />
      {commerceEnabled && <MobileCartBar cartCount={cartCount} onOpenCheckout={() => setShowCheckout(true)} />}
      {organization.whatsappNumber && (
        <WhatsAppButton
          number={organization.whatsappNumber}
          shopName={organization.name}
          raised={commerceEnabled && cartCount > 0}
        />
      )}

      {showBooking && (
        <BookingPanel
          slug={slug}
          offer={offer}
          onClose={() => setShowBooking(false)}
          onSuccess={() => {
            setShowBooking(false);
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
          onClose={() => setShowCheckout(false)}
          onSuccess={(orderNumber) => {
            clearCart();
            setShowCheckout(false);
            setConfirmation(`Commande ${orderNumber} confirmée, merci !`);
            void queryClient.invalidateQueries({ queryKey: ["public-offers", slug] });
            void queryClient.invalidateQueries({ queryKey: ["public-offer", slug, offerId] });
          }}
        />
      )}
    </div>
  );
}

/**
 * Real customer reviews — distinct from the org-curated Testimonials content section (Pro plan,
 * shown on the storefront homepage). These come from CreateReviewInput submissions on a genuinely
 * completed order/booking and are anonymized ("Client vérifié", no reviewer name) since the
 * customer never consented to public display of their identity the way a testimonial's typed-in
 * author did. Renders nothing while there are zero reviews, matching every other optional
 * storefront section's "absent means don't render" convention.
 */
function OfferReviews({ slug, offerId }: { slug: string; offerId: string }) {
  const { data } = useQuery({
    queryKey: ["public-offer-reviews", slug, offerId],
    queryFn: () =>
      publicApiClient.get<PublicOfferReviewSummary>(`/public/${slug}/offers/${offerId}/reviews`),
    retry: false,
  });

  if (!data || data.count === 0) return null;

  return (
    <Card className="p-6">
      <h2 className="text-lg font-semibold text-text">Avis clients</h2>
      <div className="mt-2 flex items-center gap-2">
        {data.average != null && <Stars rating={Math.round(data.average)} />}
        {data.average != null && (
          <span className="text-sm font-medium text-text">{data.average.toFixed(1)}</span>
        )}
        <span className="text-sm text-text-muted">({data.count} avis)</span>
      </div>
      <ul className="mt-4 divide-y divide-border">
        {data.reviews.map((review, index) => (
          <li key={index} className="py-3 first:pt-0 last:pb-0">
            <Stars rating={review.rating} />
            {review.comment && <p className="mt-1 text-sm text-text-muted">{review.comment}</p>}
            <p className="mt-1 text-xs text-text-muted">Client vérifié</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-amber-500" aria-label={`${rating} sur 5 étoiles`}>
      {"★".repeat(rating)}
      <span className="text-border">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

function BackLink({ slug }: { slug: string }) {
  return (
    <Link href={`/${slug}`} className="inline-block text-sm text-[var(--kt-text-muted,var(--color-text-muted))] hover:underline">
      ← Retour à la boutique
    </Link>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-1 bg-app-background text-sm text-text-muted">
      {children}
    </div>
  );
}

function DetailSkeleton({ slug }: { slug: string }) {
  return (
    <div className="min-h-screen bg-app-background">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto max-w-4xl">
          <div className="h-5 w-40 animate-pulse rounded bg-surface-muted" />
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-6 py-8">
        <BackLink slug={slug} />
        <Card className="overflow-hidden p-6 sm:flex sm:gap-6">
          <div className="h-56 w-full animate-pulse rounded-md bg-surface-muted sm:w-64" />
          <div className="mt-4 flex-1 space-y-3 sm:mt-0">
            <div className="h-6 w-2/3 animate-pulse rounded bg-surface-muted" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-muted" />
            <div className="h-4 w-full animate-pulse rounded bg-surface-muted" />
            <div className="h-4 w-5/6 animate-pulse rounded bg-surface-muted" />
          </div>
        </Card>
      </main>
    </div>
  );
}
