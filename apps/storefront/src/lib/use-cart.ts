"use client";

import { useCallback, useEffect, useState } from "react";
import type { CartLine } from "./public-types";
import { publicApiClient } from "./public-api-client";

/** The options chosen for one cart line, as the offer page resolved them. */
export interface ChosenOptions {
  ids: string[];
  labels: string[];
  priceDelta: number;
}

/** Identity of a set of options, independent of the order they were picked in. */
export function optionKey(optionIds: string[] | undefined): string {
  return optionIds ? [...optionIds].sort().join(",") : "";
}

function cartStorageKey(slug: string): string {
  return `korva-storefront-cart:${slug}`;
}

/** Lines the shopper put aside ("Mettre de côté"): kept apart from the basket, so they are never
 *  ordered by accident, and brought back with one tap. Same per-shop, browser-only storage. */
function savedStorageKey(slug: string): string {
  return `korva-storefront-saved:${slug}`;
}

/** Two lines are the same product when offer, variant, options and chosen amount all match. */
export function lineKey(line: Pick<CartLine, "offerId" | "variantId" | "optionIds" | "amount">): string {
  return `${line.offerId}:${line.variantId ?? ""}:${optionKey(line.optionIds)}:${line.amount ?? ""}`;
}

/** Adds `line` to `lines`, merging its quantity into an identical line already there. */
function mergeLine(lines: CartLine[], line: CartLine): CartLine[] {
  const key = lineKey(line);
  return lines.some((candidate) => lineKey(candidate) === key)
    ? lines.map((candidate) =>
        lineKey(candidate) === key ? { ...candidate, quantity: candidate.quantity + line.quantity } : candidate,
      )
    : [...lines, line];
}

function readLines(key: string): CartLine[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    // Corrupt entry or storage unavailable (private mode, disabled storage) — start empty.
    return [];
  }
}

function writeLines(key: string, lines: CartLine[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(lines));
  } catch {
    // Storage unavailable/full — the lines just won't survive a reload; still work in-memory.
  }
}

/** The most of one line a basket takes — a typo of 1000 never reaches the order form. */
export const MAX_LINE_QUANTITY = 99;

/**
 * A commerce cart that survives navigation between the catalog page and an offer's own detail
 * page (both real routes now — see the [slug]/offers/[offerId] route added in Wave 2 Agent F).
 * Persisted to localStorage, scoped per organization slug, and never sent anywhere itself — it
 * only feeds the existing POST /public/:slug/orders call, which always re-resolves price from
 * the real Offer server-side. This is client-side convenience state (like any storefront cart),
 * not a substitute for the server-backed order/booking history explicitly scoped out in this
 * wave's report (BACKEND CONTRACT REQUIRED).
 */
/** The signed-in customer, when there is one: the basket then follows their account. */
export interface CartAccount {
  isAuthenticated: boolean;
  authFetch: <T>(fn: (accessToken: string) => Promise<T>) => Promise<T>;
}

export function useCart(slug: string, account?: CartAccount) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saved, setSaved] = useState<CartLine[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // Set once the account's basket has been merged in; from then on changes are saved to it.
  const [accountSynced, setAccountSynced] = useState(false);

  // Reads localStorage (unavailable during SSR/first paint) to hydrate the cart post-mount —
  // the standard React pattern for syncing from a browser-only external source
  // (https://react.dev/learn/synchronizing-with-effects#fetching-data), which unavoidably means
  // a one-time setState once the real value is known. Deliberately not moved to render-time
  // (e.g. useState(() => readCart(slug))): that would read localStorage during the server
  // render too and desync from the client's real value, causing a hydration mismatch on the
  // very "Panier (N)" button this cart drives.
  /* eslint-disable react-hooks/set-state-in-effect -- see comment above */
  useEffect(() => {
    setCart(readLines(cartStorageKey(slug)));
    setSaved(readLines(savedStorageKey(slug)));
    setHydrated(true);
  }, [slug]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (hydrated) writeLines(cartStorageKey(slug), cart);
  }, [slug, cart, hydrated]);
  useEffect(() => {
    if (hydrated) writeLines(savedStorageKey(slug), saved);
  }, [slug, saved, hydrated]);

  // Signed in: what the account kept (from another phone, another day) joins what is in this
  // browser — never replacing it — and the result is saved back to the account.
  const signedIn = account?.isAuthenticated ?? false;
  const authFetch = account?.authFetch;
  useEffect(() => {
    if (!hydrated || !signedIn || !authFetch || accountSynced) return;
    let cancelled = false;
    authFetch((token) =>
      publicApiClient.get<{ cart: CartLine[]; saved: CartLine[] }>(`/public/${slug}/account/basket`, token),
    )
      .then((remote) => {
        if (cancelled) return;
        setCart((local) => remote.cart.reduce(mergeLine, local));
        setSaved((local) => remote.saved.reduce(mergeLine, local));
        setAccountSynced(true);
      })
      .catch(() => {
        // Account unreachable: the basket keeps working in this browser.
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, signedIn, authFetch, accountSynced, slug]);
  useEffect(() => {
    // Signed out: nothing more goes to the account; the basket stays in this browser.
    if (!accountSynced || !signedIn || !authFetch) return;
    const timer = setTimeout(() => {
      void authFetch((token) =>
        publicApiClient.put(`/public/${slug}/account/basket`, { cart, saved }, token),
      ).catch(() => {
        // Retried with the next change.
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [accountSynced, signedIn, authFetch, slug, cart, saved]);

  const addToCart = useCallback(
    (
      offer: { id: string; name: string; pricing: { amount: number } },
      variant?: { id: string; name: string; priceOverride?: number },
      options?: ChosenOptions,
      /** A donation's chosen amount (Offer.freeAmount); replaces the price for display. */
      amount?: number,
    ) => {
      const optionIds = options?.ids.length ? [...options.ids].sort() : undefined;
      const sameLine = (line: CartLine) =>
        line.offerId === offer.id &&
        line.variantId === variant?.id &&
        optionKey(line.optionIds) === optionKey(optionIds) &&
        line.amount === amount;
      setCart((prev) => {
        if (prev.some(sameLine)) {
          return prev.map((line) =>
            sameLine(line) ? { ...line, quantity: line.quantity + 1 } : line,
          );
        }
        const baseName = variant ? `${offer.name} — ${variant.name}` : offer.name;
        return [
          ...prev,
          {
            offerId: offer.id,
            variantId: variant?.id,
            optionIds,
            name: options?.labels.length ? `${baseName} (${options.labels.join(", ")})` : baseName,
            unitPrice: amount ?? (variant?.priceOverride ?? offer.pricing.amount) + (options?.priceDelta ?? 0),
            amount,
            quantity: 1,
          },
        ];
      });
    },
    [],
  );

  const clearCart = useCallback(() => setCart([]), []);

  /** 0 removes the line; anything above MAX_LINE_QUANTITY is capped. */
  const setQuantity = useCallback((key: string, quantity: number) => {
    const next = Math.min(MAX_LINE_QUANTITY, Math.max(0, Math.floor(quantity)));
    setCart((prev) =>
      next === 0
        ? prev.filter((line) => lineKey(line) !== key)
        : prev.map((line) => (lineKey(line) === key ? { ...line, quantity: next } : line)),
    );
  }, []);

  const removeLine = useCallback((key: string) => {
    setCart((prev) => prev.filter((line) => lineKey(line) !== key));
  }, []);

  /** Moves one line out of the basket into "Mis de côté". */
  const saveForLater = useCallback(
    (key: string) => {
      const line = cart.find((candidate) => lineKey(candidate) === key);
      if (!line) return;
      setCart((prev) => prev.filter((candidate) => lineKey(candidate) !== key));
      setSaved((prev) => mergeLine(prev, line));
    },
    [cart],
  );

  /** Puts the whole basket aside — the "brouillon" of an order the shopper will finish later. */
  const saveAllForLater = useCallback(() => {
    setSaved((prev) => cart.reduce(mergeLine, prev));
    setCart([]);
  }, [cart]);

  /** Brings a line put aside back into the basket. */
  const restoreSaved = useCallback(
    (key: string) => {
      const line = saved.find((candidate) => lineKey(candidate) === key);
      if (!line) return;
      setSaved((prev) => prev.filter((candidate) => lineKey(candidate) !== key));
      setCart((prev) => mergeLine(prev, line));
    },
    [saved],
  );

  const removeSaved = useCallback((key: string) => {
    setSaved((prev) => prev.filter((line) => lineKey(line) !== key));
  }, []);

  return {
    cart,
    saved,
    addToCart,
    clearCart,
    setQuantity,
    removeLine,
    saveForLater,
    saveAllForLater,
    restoreSaved,
    removeSaved,
  };
}

/** What the basket dialog can do to the basket — everything useCart offers but adding. */
export type CartActions = Omit<ReturnType<typeof useCart>, "cart" | "addToCart">;
