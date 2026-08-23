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
    let cancelled = false;

    getRefreshedAccessToken()
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
