"use client";

import { useEffect } from "react";
import { apiClient } from "./api-client";
import { useAuthStore } from "./auth-store";

interface RefreshResponse {
  accessToken: string;
}

/**
 * Runs once per page load. The access token is never persisted (see auth-store.ts), so on a
 * fresh load it starts out null — this silently calls POST /auth/refresh (the browser sends
 * the HttpOnly refresh cookie automatically) to recover a working access token before any
 * route guard decides the user is logged out. A missing/expired cookie is a normal "not
 * logged in" outcome, not an error to surface.
 */
export function useAuthBootstrap(): void {
  const bootstrapped = useAuthStore((state) => state.bootstrapped);
  const setAccessToken = useAuthStore((state) => state.setAccessToken);
  const setBootstrapped = useAuthStore((state) => state.setBootstrapped);
  const clear = useAuthStore((state) => state.clear);

  useEffect(() => {
    if (bootstrapped) return;
    let cancelled = false;

    apiClient
      .post<RefreshResponse>("/auth/refresh", undefined, { withOrganization: false })
      .then((data) => {
        if (!cancelled) setAccessToken(data.accessToken);
      })
      .catch(() => {
        if (!cancelled) clear();
      })
      .finally(() => {
        if (!cancelled) setBootstrapped(true);
      });

    return () => {
      cancelled = true;
    };
  }, [bootstrapped, setAccessToken, setBootstrapped, clear]);
}
