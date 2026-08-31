"use client";

import { useCallback, useEffect, useState } from "react";
import type { CartLine } from "./public-types";

function cartStorageKey(slug: string): string {
  return `korva-storefront-cart:${slug}`;
}

/**
 * A commerce cart that survives navigation between the catalog page and an offer's own detail
 * page (both real routes now — see the [slug]/offers/[offerId] route added in Wave 2 Agent F).
 * Persisted to localStorage, scoped per organization slug, and never sent anywhere itself — it
 * only feeds the existing POST /public/:slug/orders call, which always re-resolves price from
 * the real Offer server-side. This is client-side convenience state (like any storefront cart),
 * not a substitute for the server-backed order/booking history explicitly scoped out in this
 * wave's report (BACKEND CONTRACT REQUIRED).
 */
export function useCart(slug: string) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Reads localStorage (unavailable during SSR/first paint) to hydrate the cart post-mount —
  // the standard React pattern for syncing from a browser-only external source
  // (https://react.dev/learn/synchronizing-with-effects#fetching-data), which unavoidably means
  // a one-time setState once the real value is known. Deliberately not moved to render-time
  // (e.g. useState(() => readCart(slug))): that would read localStorage during the server
  // render too and desync from the client's real value, causing a hydration mismatch on the
  // very "Panier (N)" button this cart drives.
  /* eslint-disable react-hooks/set-state-in-effect -- see comment above */
  useEffect(() => {
    let nextCart: CartLine[] = [];
    try {
      const raw = window.localStorage.getItem(cartStorageKey(slug));
      nextCart = raw ? (JSON.parse(raw) as CartLine[]) : [];
    } catch {
      // Corrupt entry or storage unavailable (private mode, disabled storage) — start empty.
    }
    setCart(nextCart);
    setHydrated(true);
  }, [slug]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(cartStorageKey(slug), JSON.stringify(cart));
    } catch {
      // Storage unavailable/full — the cart just won't survive a reload; still works in-memory.
    }
  }, [slug, cart, hydrated]);

  const addToCart = useCallback(
    (
      offer: { id: string; name: string; pricing: { amount: number } },
      variant?: { id: string; name: string; priceOverride?: number },
    ) => {
      setCart((prev) => {
        const existing = prev.find(
          (line) => line.offerId === offer.id && line.variantId === variant?.id,
        );
        if (existing) {
          return prev.map((line) =>
            line.offerId === offer.id && line.variantId === variant?.id
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          );
        }
        return [
          ...prev,
          {
            offerId: offer.id,
            variantId: variant?.id,
            name: variant ? `${offer.name} — ${variant.name}` : offer.name,
            unitPrice: variant?.priceOverride ?? offer.pricing.amount,
            quantity: 1,
          },
        ];
      });
    },
    [],
  );

  const clearCart = useCallback(() => setCart([]), []);

  return { cart, addToCart, clearCart };
}
