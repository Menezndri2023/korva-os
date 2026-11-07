"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { StorefrontFontPairingKey, StorefrontPaletteKey, StorefrontTemplateKey } from "@korva/types";
import { publicApiClient } from "@/lib/public-api-client";
import { useCart } from "@/lib/use-cart";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { BookingPanel, CheckoutPanel } from "./lazy-commerce-panels";
import { resolveStorefrontStyle } from "@/templates/palette";
import { StorefrontThemeStyle } from "@/templates/storefront-theme-style";
import { MobileCartBar } from "@/templates/sections/MobileCartBar";
import { WhatsAppButton } from "@/templates/sections/WhatsAppButton";
import type { StorefrontTemplateProps } from "@/templates/types";
import { EssentielTemplate } from "@/templates/essentiel/EssentielTemplate";
import { VitrineTemplate } from "@/templates/vitrine/VitrineTemplate";
import { TableTemplate } from "@/templates/table/TableTemplate";
import { BoutiqueTemplate } from "@/templates/boutique/BoutiqueTemplate";
import { AcademieTemplate } from "@/templates/academie/AcademieTemplate";
import { SalonTemplate } from "@/templates/salon/SalonTemplate";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/storefront-locale";

/**
 * Renders the concrete, statically-named template component for `props.style`'s template key.
 * Deliberately a switch over literal JSX tags rather than a `key -> component` lookup used as a
 * dynamic tag (`<TemplateComponent .../>`) — several templates (e.g. BoutiqueTemplate) call
 * hooks internally, so the rendered component identity must stay static across renders for
 * hooks ordering to stay valid, which the eslint-plugin-react-hooks "static-components" rule
 * enforces by requiring a literal tag name here.
 */
function renderTemplate(key: string, props: StorefrontTemplateProps) {
  switch (key) {
    case "vitrine":
      return <VitrineTemplate {...props} />;
    case "table":
      return <TableTemplate {...props} />;
    case "boutique":
      return <BoutiqueTemplate {...props} />;
    case "academie":
      return <AcademieTemplate {...props} />;
    case "salon":
      return <SalonTemplate {...props} />;
    default:
      return <EssentielTemplate {...props} />;
  }
}

/**
 * Live-preview-only override read from the URL — used exclusively by the dashboard's storefront
 * preview iframe (apps/web Settings page) so an unsaved template/palette/font choice can be
 * previewed before the organization update is actually submitted. Purely presentational: it
 * never bypasses plan gating for what actually gets *saved* (that's enforced server-side by
 * EntitlementsService.assertStorefrontThemeAllowed), it only changes what this one page renders.
 */
function usePreviewOverride() {
  // Read through useSyncExternalStore with an empty server snapshot, so the server render and
  // the hydration pass agree (no override), and React then re-renders with the URL's choice.
  // Reading `window` in a lazy useState initializer made the first client render differ from
  // the server's HTML — React error #418 in every preview, and a full client re-render.
  const search = useSyncExternalStore(subscribeToNothing, readSearch, readNoSearch);

  return useMemo(() => {
    if (!search) return null;
    const params = new URLSearchParams(search);
    const template = params.get("template") as StorefrontTemplateKey | null;
    const palette = params.get("palette") as StorefrontPaletteKey | null;
    const fontPairing = params.get("font") as StorefrontFontPairingKey | null;
    if (!template && !palette && !fontPairing) return null;
    return {
      template: template ?? undefined,
      palette: palette ?? undefined,
      fontPairing: fontPairing ?? undefined,
    };
  }, [search]);
}

// The preview's query string never changes after load: nothing to subscribe to.
const subscribeToNothing = () => () => {};
const readSearch = () => window.location.search;
const readNoSearch = () => "";

/**
 * `initialOrganization`/`initialOffers` come from the server render (see page.tsx) and are what
 * put the tenant's actual content into the initial HTML. Both are optional: the dashboard's
 * preview iframe and any future caller can still mount this with nothing and let the queries
 * fetch, exactly as before.
 */
export default function StorefrontClient({
  slug,
  nonce,
  initialOrganization,
  initialOffers,
}: {
  slug: string;
  nonce?: string;
  initialOrganization?: PublicOrganization;
  initialOffers?: PublicOffer[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const previewOverride = usePreviewOverride();

  const orgQuery = useQuery({
    queryKey: ["public-org", slug],
    queryFn: () => publicApiClient.get<PublicOrganization>(`/public/${slug}`),
    retry: false,
    // Providers sets staleTime: 30s, so seeding this does not trigger an immediate duplicate
    // fetch in the browser — the first paint is the server's data and it is reused.
    initialData: initialOrganization,
  });
  const offersQuery = useQuery({
    queryKey: ["public-offers", slug],
    queryFn: () => publicApiClient.get<PublicOffer[]>(`/public/${slug}/offers`),
    enabled: !!orgQuery.data?.visibleSections.includes("catalog"),
    // Only seeded when the server actually fetched them. An empty array where the catalog IS
    // visible would otherwise read as "this shop has no offers" for the first 30 seconds.
    initialData:
      initialOrganization?.visibleSections.includes("catalog") && initialOffers
        ? initialOffers
        : undefined,
  });


  const router = useRouter();
  const { hydrated: authHydrated, isAuthenticated, customer, authFetch } = useCustomerAuth(slug);
  const basket = useCart(slug, { isAuthenticated, authFetch });
  const { cart, addToCart, clearCart } = basket;
  const [bookingOffer, setBookingOffer] = useState<PublicOffer | null>(null);
  const [showCheckout, setShowCheckout] = useState(false);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Computed before the loading/error early returns below so every hook in this component runs
  // on every render, regardless of which branch is ultimately returned — `organization.storefrontTheme`
  // isn't available yet while `orgQuery` is loading, so this falls back to "essentiel" until it is.
  const baseTheme = orgQuery.data?.storefrontTheme ?? {
    template: "essentiel" as const,
    fontPairing: "sobre" as const,
    customAccentApplied: false,
  };
  const effectiveTheme = {
    ...baseTheme,
    ...(previewOverride?.template ? { template: previewOverride.template } : {}),
    ...(previewOverride?.palette ? { palette: previewOverride.palette } : {}),
    ...(previewOverride?.fontPairing ? { fontPairing: previewOverride.fontPairing } : {}),
  };
  if (orgQuery.isLoading) {
    return <StorefrontSkeleton />;
  }
  // "Could not load" is not "does not exist", and this branch used to say the second for both.
  // The server now answers a genuinely unknown slug with notFound() before this component ever
  // renders (see page.tsx), so everything reaching here is a failure we could not diagnose —
  // most often the API being unreachable while this container is fine. A real shop's customers
  // must not be told the business is gone because of that, and the retry button only makes
  // sense for something that might succeed on a second try.
  if (orgQuery.isError || !orgQuery.data) {
    return (
      <CenteredMessage>
        <p>{t("Cette boutique est momentanément indisponible.", "This shop is temporarily unavailable.")}</p>
        <button onClick={() => orgQuery.refetch()} className="mt-2 text-sm font-medium text-text underline">
          {t("Réessayer", "Try again")}
        </button>
      </CenteredMessage>
    );
  }
  const organization = orgQuery.data;
  const style = resolveStorefrontStyle(effectiveTheme, organization.brandColor);

  const catalogVisible = organization.visibleSections.includes("catalog");
  const bookingEnabled = organization.visibleSections.includes("booking");
  const commerceEnabled = organization.enabledModules.includes("commerce");
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const templateProps: StorefrontTemplateProps = {
    slug,
    organization,
    catalogVisible,
    offers: offersQuery.data,
    offersLoading: offersQuery.isLoading,
    offersError: offersQuery.isError,
    onRetryOffers: () => offersQuery.refetch(),
    bookingEnabled,
    commerceEnabled,
    onBook: (offer) => setBookingOffer(offer),
    // An offer with options (cuisson, taille...) cannot be added without its choices: the card's
    // button opens the offer page, where they are made, instead of adding a choiceless line the
    // API would refuse at checkout.
    onAddToCart: (offer) =>
      offer.optionGroups?.length ? router.push(`/${slug}/offers/${offer.id}`) : addToCart(offer),
    cartCount,
    onOpenCheckout: () => setShowCheckout(true),
    confirmation,
    authHydrated,
    isAuthenticated,
    customerFirstName: customer?.firstName,
  };

  return (
    <>
      <StorefrontThemeStyle style={style} nonce={nonce} />
      {renderTemplate(effectiveTheme.template, templateProps)}
      {commerceEnabled && <MobileCartBar cartCount={cartCount} onOpenCheckout={() => setShowCheckout(true)} />}
      {organization.whatsappNumber && (
        <WhatsAppButton
          number={organization.whatsappNumber}
          shopName={organization.name}
          raised={commerceEnabled && cartCount > 0}
        />
      )}
      {organization.poweredByKorva && (
        <p className="bg-[var(--kt-surface)] pb-5 text-center text-xs text-[var(--kt-text-muted)]">
          {t("Site propulsé par", "Website powered by")}{" "}
          <a
            href="https://korvasuite.com"
            className="inline-flex items-center gap-1 align-middle font-medium underline-offset-2 hover:underline"
          >
            {/* KORVA's cowrie, small: the credit carries the brand, not just its name. */}
            <svg viewBox="0 0 48 48" aria-hidden className="h-3.5 w-3.5">
              <ellipse cx="24" cy="24" rx="14" ry="19" fill="#f2a33a" />
              <path d="M24 8.5c-2.4 5-2.4 26 0 31" fill="none" stroke="#0f3b42" strokeWidth="5" strokeLinecap="round" />
            </svg>
            KORVA
          </a>
        </p>
      )}

      {bookingOffer && (
        <BookingPanel
          slug={slug}
          acceptsOnlinePayment={organization.acceptedPaymentMethods.includes("online")}
          offer={bookingOffer}
          onClose={() => setBookingOffer(null)}
          onSuccess={() => {
            setBookingOffer(null);
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
          customer={isAuthenticated && customer ? customer : undefined}
          onClose={() => setShowCheckout(false)}
          onSuccess={(orderNumber) => {
            clearCart();
            setShowCheckout(false);
            setConfirmation(t(`Commande ${orderNumber} confirmée, merci !`, `Order ${orderNumber} confirmed, thank you!`));
            void queryClient.invalidateQueries({ queryKey: ["public-offers", slug] });
          }}
        />
      )}
    </>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-app-background text-sm text-text-muted">
      {children}
    </div>
  );
}

function StorefrontSkeleton() {
  return (
    <div className="min-h-screen bg-app-background">
      <header className="border-b border-border bg-surface px-6 py-4">
        <div className="mx-auto max-w-4xl">
          <div className="h-5 w-40 animate-pulse rounded bg-surface-muted" />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-md border border-border bg-surface" />
          ))}
        </div>
      </main>
    </div>
  );
}
