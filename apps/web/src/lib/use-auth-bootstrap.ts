"use client";

import { useEffect } from "react";
import { getRefreshedAccessToken } from "./api-client";
import { useAuthStore } from "./auth-store";

/**
 * Runs once per page load. The access token is never persisted (see auth-store.ts), so on a
 * fresh load it starts out null — this silently calls POST /auth/refresh (the browser sends
 * the HttpOnly refresh cookie automatically) to recover a working access token before any
 * route guard decides the user is logged out. A missing/expired cookie is a normal "not
 * logged in" outcome, not an error to surface.
 *
 * Goes through the shared getRefreshedAccessToken() — the same dedup used by the 401-retry
 * path in api-client.ts — instead of calling POST /auth/refresh directly, so that React
 * Strict Mode's double-invoked effect (two mounts in dev) shares a single in-flight refresh
 * instead of racing two requests against the same rotating refresh token. It already writes
 * accessToken/clears the store internally on success/failure; this hook only tracks
 * `bootstrapped` and lets an unmounted instance's turn be a no-op.
 */
export function useAuthBootstrap(): void {
  const bootstrapped = useAuthStore((state) => state.bootstrapped);
  const setBootstrapped = useAuthStore((state) => state.setBootstrapped);

  useEffect(() => {
    if (bootstrapped) return;
    // Nobody has signed in from this browser (no remembered user): there is no session to
    // recover, so skip the call that could only answer 401 — every anonymous visit of the landing
    // page, the sign-in pages and the administration used to make it.
    if (!useAuthStore.getState().user) {
      setBootstrapped(true);
      return;
    }
    let cancelled = false;

    refreshWithRetries(() => cancelled)
      .catch(() => {
        // A missing/expired/already-rotated-away refresh token is a normal "not logged in"
        // outcome here — getRefreshedAccessToken() has already cleared the store.
      })
      .finally(() => {
        if (!cancelled) setBootstrapped(true);
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrapped, setBootstrapped]);
}

/** Waits between attempts when the refresh failed for a passing reason. Together they outlast
 *  the API's rate-limit window (one minute), so a limited address is not sent to sign-in. */
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000, 20_000, 45_000];

/**
 * A refresh that fails because the server REFUSED the session clears the store (see
 * refreshAccessToken), and that is final. One that fails for a passing reason — no network, the
 * API's rate limit, a server error — leaves the saved user in place: then try again a few times
 * before giving up, instead of sending someone with a valid session to the sign-in page because
 * of one dropped request on a mobile network.
 */
async function refreshWithRetries(isCancelled: () => boolean): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await getRefreshedAccessToken();
      return;
    } catch (error) {
      const { user, viewOnly } = useAuthStore.getState();
      const passing = user !== null && viewOnly === null;
      if (!passing || attempt >= RETRY_DELAYS_MS.length || isCancelled()) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
      // Unmounted while waiting: the page that wanted the session is gone.
      if (isCancelled()) throw error;
    }
  }
}

