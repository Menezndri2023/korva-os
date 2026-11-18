"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card } from "@korva/ui";
import { PublicApiError, publicApiClient } from "@/lib/public-api-client";
import { useCart } from "@/lib/use-cart";
import { offerTypeLabel, formatOfferPrice } from "@/lib/offer-labels";
import type { PublicOffer, PublicOfferReviewSummary, PublicOrganization } from "@/lib/public-types";
import { BookingPanel, CheckoutPanel, RequestPanel } from "../../lazy-commerce-panels";
import { requestLabel, type RequestKind } from "@/lib/request-kind";
import { OfferPrice } from "@/templates/sections/OfferPrice";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import { resolveStorefrontStyle } from "@/templates/palette";
import { StorefrontThemeStyle } from "@/templates/storefront-theme-style";
import { RatingSummary, ReviewItem } from "@/templates/sections/CustomerReviews";
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
import { useStorefrontLocale, useT } from "@/lib/storefront-locale";
import { uploadImage } from "@/lib/upload-image";

export default function OfferDetailClient({
  slug,
  offerId,
  nonce,
}: {
  slug: string;
  offerId: string;
  nonce?: string;
}) {
  const locale = useStorefrontLocale();
  const t = useT();
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

  const { hydrated: authHydrated, isAuthenticated, customer, authFetch } = useCustomerAuth(slug);
  const basket = useCart(slug, { isAuthenticated, authFetch });
  const { cart, addToCart, clearCart } = basket;
  const [showBooking, setShowBooking] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [showRequest, setShowRequest] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [activeImage, setActiveImage] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  // A donation's amount, as typed; starts at the minimum the business set (Offer.freeAmount).
  const [chosenAmount, setChosenAmount] = useState("");

  if (orgQuery.isLoading || (orgQuery.data && offerQuery.isLoading)) {
    return <DetailSkeleton slug={slug} />;
  }
  if (orgQuery.isError || !orgQuery.data) {
    return (
      <CenteredMessage>
        <p>{t("Cette boutique n'existe pas.", "This shop does not exist.")}</p>
        <button onClick={() => orgQuery.refetch()} className="mt-2 text-sm font-medium underline">
          {t("Réessayer", "Try again")}
        </button>
      </CenteredMessage>
    );
  }
  const organization = orgQuery.data;

  if (!organization.enabledModules.includes("catalog")) {
    return (
      <CenteredMessage>
        <p>{t(
          "Aucun catalogue disponible pour cette boutique.",
          "No catalogue is available for this shop.",
        )}</p>
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
          <p>{t(
            "Cette offre n'existe pas ou n'est plus disponible.",
            "This offer does not exist or is no longer available.",
          )}</p>
          <BackLink slug={slug} />
        </CenteredMessage>
      );
    }
    return (
      <CenteredMessage>
        <p>{t("Impossible de charger cette offre.", "This offer could not be loaded.")}</p>
        <button onClick={() => offerQuery.refetch()} className="mt-2 text-sm font-medium underline">
          {t("Réessayer", "Try again")}
        </button>
      </CenteredMessage>
    );
  }

  const offer = offerQuery.data;
  if (!offer) {
    return (
      <CenteredMessage>
        <p>{t(
          "Cette offre n'existe pas ou n'est plus disponible.",
          "This offer does not exist or is no longer available.",
        )}</p>
        <BackLink slug={slug} />
      </CenteredMessage>
    );
  }

  const bookingEnabled = organization.enabledModules.includes("booking");
  const commerceEnabled = organization.enabledModules.includes("commerce");
  // An offer nobody can order or book on the site is asked about instead — a quote, a visit, or
  // information — whenever the business keeps a CRM to receive the request.
  const requestKind: RequestKind | null =
    !organization.enabledModules.includes("crm") ||
    (offer.type === "booking" ? bookingEnabled : commerceEnabled)
      ? null
      : organization.businessModel === "quotes"
        ? "quote"
        : organization.businessModel === "real_estate"
          ? "visit"
          : "info";
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const images = offer.images;
  const selectedVariant =
    offer.variants.find((v) => v.id === selectedVariantId) ?? offer.variants[0];
  const optionGroups = offer.optionGroups ?? [];
  const missingOptions = missingRequiredGroups(optionGroups, selectedOptionIds);
  const chosenAmountValue = chosenAmount.trim() === "" ? undefined : Number(chosenAmount);
  const amountTooLow =
    Boolean(offer.freeAmount) &&
    chosenAmountValue !== undefined &&
    (!Number.isFinite(chosenAmountValue) || chosenAmountValue < offer.pricing.amount);

  // The offer page wears the shop's theme like its home page — it is the page a link shared on
  // WhatsApp opens, and it used to be the one page of the site in neutral grey.
  const style = resolveStorefrontStyle(organization.storefrontTheme, organization.brandColor);
  const links = siteLinks(slug, organization.visibleSections.includes("catalog"), {
    catalog: t("Catalogue complet", "Full catalogue"),
    track: t("Suivre ma commande", "Track my order"),
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
                    {...uploadImage(activeSrc, [640, 960, 1280], "(min-width: 768px) 50vw, 100vw")}
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
                        <img {...uploadImage(image, [160, 320], "96px")} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
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
              <Badge>{offerTypeLabel(offer.type, locale)}</Badge>
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
                <h2 className="text-sm font-medium">{t("Variantes", "Variants")}</h2>
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
                          <th className="px-3 py-2">{t("Variante", "Variant")}</th>
                          <th className="px-3 py-2">{t("SKU", "SKU")}</th>
                          <th className="px-3 py-2">{t("Prix", "Price")}</th>
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
                                ? formatOfferPrice(variant.priceOverride, offer.pricing.currency, locale)
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
                  {t("Réserver", "Book")}
                </Button>
              )}
              {offer.freeAmount && offer.type !== "booking" && commerceEnabled && (
                <label className="flex flex-col gap-1 text-sm sm:mr-2">
                  <span className={KT.textMuted}>
                    {t("Montant (minimum ", "Amount (minimum ")}
                    {formatOfferPrice(offer.pricing.amount, offer.pricing.currency, locale)})
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={offer.pricing.amount}
                    step="any"
                    aria-label={t("Montant que vous choisissez", "Amount you choose")}
                    placeholder={String(offer.pricing.amount)}
                    value={chosenAmount}
                    onChange={(e) => setChosenAmount(e.target.value)}
                    className={`min-h-11 w-full rounded-lg border px-3 sm:w-44 ${KT.border} ${KT.surface}`}
                  />
                  {amountTooLow && (
                    <span className="text-xs text-destructive" role="alert">
                      {t("Le montant doit être d'au moins ", "The amount must be at least ")}
                      {formatOfferPrice(offer.pricing.amount, offer.pricing.currency, locale)}
                    </span>
                  )}
                </label>
              )}
              {offer.type !== "booking" && commerceEnabled && (
                <Button
                  size="lg"
                  className={`w-full sm:w-auto ${KT.accentBg} ${KT.accentContrastText}`}
                  disabled={missingOptions.length > 0 || amountTooLow}
                  onClick={() => {
                    addToCart(
                      offer,
                      selectedVariant,
                      summarizeOptions(optionGroups, selectedOptionIds),
                      offer.freeAmount ? (chosenAmountValue ?? offer.pricing.amount) : undefined,
                    );
                    setSelectedOptionIds([]);
                    setChosenAmount("");
                  }}
                >
                  {t("Ajouter au panier", "Add to basket")}
                </Button>
              )}
              {requestKind && (
                <Button size="lg" className={`w-full sm:w-auto ${KT.accentBg} ${KT.accentContrastText}`} onClick={() => setShowRequest(true)}>
                  {t(...requestLabel(requestKind))}
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
                    const price = formatOfferPrice(offer.pricing.amount, offer.pricing.currency, locale);
                    window.open(
                      whatsappLink(
                        organization.whatsappNumber!,
                        t(
                        `Bonjour ${organization.name}, je suis intéressé(e) par « ${offer.name} » (${price}) : ${window.location.href}`,
                        `Hello ${organization.name}, I am interested in “${offer.name}” (${price}): ${window.location.href}`,
                      ),
                      ),
                      "_blank",
                      "noopener,noreferrer",
                    );
                  }}
                >
                  <MessageCircle aria-hidden className="h-5 w-5" />
                  {offer.type === "booking" || requestKind
                    ? t("Demander sur WhatsApp", "Ask on WhatsApp")
                    : t("Commander sur WhatsApp", "Order on WhatsApp")}
                </Button>
              )}
              {missingOptions.length > 0 && offer.type !== "booking" && commerceEnabled && (
                <p className={`text-sm ${KT.textMuted}`}>
                    {t("À choisir :", "Still to choose:")} {missingOptions.join(", ")}
                  </p>
              )}
            </div>
          </div>
        </div>

        <OfferReviews slug={slug} offerId={offerId} organizationName={organization.name} />
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

      {showRequest && requestKind && (
        <RequestPanel
          slug={slug}
          kind={requestKind}
          offerName={offer.name}
          onClose={() => setShowRequest(false)}
          onSuccess={() => {
            setShowRequest(false);
            setConfirmation(t(
              "Votre demande a bien été envoyée. L'entreprise vous répond au plus vite.",
              "Your request has been sent. The business will get back to you shortly.",
            ));
          }}
        />
      )}

      {showBooking && (
        <BookingPanel
          slug={slug}
          acceptsOnlinePayment={organization.acceptedPaymentMethods.includes("online")}
          offer={offer}
          onClose={() => setShowBooking(false)}
          onSuccess={() => {
            setShowBooking(false);
            setConfirmation(t(
              "Votre réservation a bien été enregistrée.",
              "Your booking has been recorded.",
            ));
          }}
        />
      )}

      {showCheckout && (
        <CheckoutPanel
          slug={slug}
          cart={cart}
          actions={basket}
          currency={organization.currency}
          shippingFlatRate={organization.shippingFlatRate}
          reception={organization}
          acceptedPaymentMethods={organization.acceptedPaymentMethods}
          onClose={() => setShowCheckout(false)}
          onSuccess={(orderNumber) => {
            clearCart();
            setShowCheckout(false);
            setConfirmation(t(`Commande ${orderNumber} confirmée, merci !`, `Order ${orderNumber} confirmed, thank you!`));
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
 * shown on the storefront homepage). Each comes from a genuinely finished order/booking; the
 * customer's first name shows only if they chose to sign. Renders nothing while there are zero
 * reviews, matching every other optional storefront section's "absent means don't render"
 * convention.
 */
function OfferReviews({
  slug,
  offerId,
  organizationName,
}: {
  slug: string;
  offerId: string;
  organizationName: string;
}) {
  const t = useT();
  const { data } = useQuery({
    queryKey: ["public-offer-reviews", slug, offerId],
    queryFn: () =>
      publicApiClient.get<PublicOfferReviewSummary>(`/public/${slug}/offers/${offerId}/reviews`),
    retry: false,
  });

  if (!data || data.count === 0) return null;

  return (
    <Card className="p-6">
      <h2 className="mb-3 text-lg font-semibold text-text">{t("Avis clients", "Customer reviews")}</h2>
      <RatingSummary average={data.average} count={data.count} />
      <ul className="mt-5 divide-y divide-border">
        {data.reviews.map((review, index) => (
          <li key={index} className="py-4 first:pt-0 last:pb-0">
            <ReviewItem review={review} organizationName={organizationName} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BackLink({ slug }: { slug: string }) {
  const t = useT();
  return (
    <Link href={`/${slug}`} className="inline-block text-sm text-[var(--kt-text-muted,var(--color-text-muted))] hover:underline">
      {t("← Retour à la boutique", "← Back to the shop")}
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
