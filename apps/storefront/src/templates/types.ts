import type { PublicOffer, PublicOrganization } from "@/lib/public-types";

/**
 * Shared contract every storefront template component renders against — see
 * storefront-client.tsx's `renderTemplate`. All data-fetching, cart/auth state, and the
 * booking/checkout dialogs themselves live once in storefront-client.tsx; templates only render
 * presentation and call back into these handlers, so switching template never touches business
 * logic. Colors/fonts are never passed as data here — templates read the organization's resolved
 * theme via the static `KT` Tailwind classes (see kt-classes.ts), never a `style={{...}}` prop
 * (see storefront-theme-style.tsx for why).
 */
export interface StorefrontTemplateProps {
  slug: string;
  organization: PublicOrganization;

  catalogVisible: boolean;
  offers: PublicOffer[] | undefined;
  offersLoading: boolean;
  offersError: boolean;
  onRetryOffers: () => void;

  bookingEnabled: boolean;
  commerceEnabled: boolean;
  onBook: (offer: PublicOffer) => void;
  onAddToCart: (offer: PublicOffer) => void;

  cartCount: number;
  onOpenCheckout: () => void;

  confirmation: string | null;

  authHydrated: boolean;
  isAuthenticated: boolean;
  customerFirstName?: string;
}
