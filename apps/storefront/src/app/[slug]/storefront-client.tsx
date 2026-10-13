"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { StorefrontFontPairingKey, StorefrontPaletteKey, StorefrontTemplateKey } from "@korva/types";
import { publicApiClient } from "@/lib/public-api-client";
import { useCart } from "@/lib/use-cart";
import { useCustomerAuth } from "@/lib/use-customer-auth";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import { BookingPanel, CheckoutPanel } from "./commerce-panels";
import { resolveStorefrontStyle } from "@/templates/palette";
import { StorefrontThemeStyle } from "@/templates/storefront-theme-style";
import type { StorefrontTemplateProps } from "@/templates/types";
import { EssentielTemplate } from "@/templates/essentiel/EssentielTemplate";
import { VitrineTemplate } from "@/templates/vitrine/VitrineTemplate";
import { TableTemplate } from "@/templates/table/TableTemplate";
import { BoutiqueTemplate } from "@/templates/boutique/BoutiqueTemplate";
import { AcademieTemplate } from "@/templates/academie/AcademieTemplate";
import { SalonTemplate } from "@/templates/salon/SalonTemplate";

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
  // Lazy initializer (not an effect) so this only ever runs once, on mount — `window` is absent
  // during the server render, which is fine: no real storefront visitor ever has these query
  // params, only the dashboard's preview iframe does.
  const [override] = useState<{
    template?: StorefrontTemplateKey;
    palette?: StorefrontPaletteKey;
    fontPairing?: StorefrontFontPairingKey;
  } | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    const template = params.get("template") as StorefrontTemplateKey | null;
    const palette = params.get("palette") as StorefrontPaletteKey | null;
    const fontPairing = params.get("font") as StorefrontFontPairingKey | null;
    if (!template && !palette && !fontPairing) return null;
    return {
      template: template ?? undefined,
      palette: palette ?? undefined,
      fontPairing: fontPairing ?? undefined,
    };
  });

  return override;
}

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

  const { cart, addToCart, clearCart } = useCart(slug);
  const { hydrated: authHydrated, isAuthenticated, customer } = useCustomerAuth(slug);
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
  if (orgQuery.isError || !orgQuery.data) {
    return (
      <CenteredMessage>
        <p>Cette boutique n&apos;existe pas.</p>
        <button onClick={() => orgQuery.refetch()} className="mt-2 text-sm font-medium text-zinc-900 underline">
          Réessayer
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
    onAddToCart: (offer) => addToCart(offer),
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
          acceptedPaymentMethods={organization.acceptedPaymentMethods}
          customer={isAuthenticated && customer ? customer : undefined}
          onClose={() => setShowCheckout(false)}
          onSuccess={(orderNumber) => {
            clearCart();
            setShowCheckout(false);
            setConfirmation(`Commande ${orderNumber} confirmée, merci !`);
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
