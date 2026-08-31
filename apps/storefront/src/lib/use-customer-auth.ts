"use client";

import { useCallback, useEffect, useState } from "react";
import { publicApiClient, PublicApiError } from "./public-api-client";
import type { CustomerAuthResponse, CustomerProfile } from "./public-types";

interface StoredAuth {
  accessToken: string;
  refreshToken: string;
  customer: CustomerProfile;
}

function storageKey(slug: string): string {
  return `korva-customer-auth:${slug}`;
}

function readStoredAuth(slug: string): StoredAuth | null {
  try {
    const raw = window.localStorage.getItem(storageKey(slug));
    return raw ? (JSON.parse(raw) as StoredAuth) : null;
  } catch {
    return null;
  }
}

function writeStoredAuth(slug: string, auth: StoredAuth | null): void {
  try {
    if (auth) {
      window.localStorage.setItem(storageKey(slug), JSON.stringify(auth));
    } else {
      window.localStorage.removeItem(storageKey(slug));
    }
  } catch {
    // Storage unavailable/full — the session just won't survive a reload.
  }
}

/**
 * Customer-portal session state for the storefront's own `/[slug]/account/...` pages —
 * bearer JWT + refresh token held in localStorage, scoped per organization slug (mirrors
 * `useCart`'s exact persistence pattern). Deliberately not a shared React Context: like
 * `useCart`, each page instantiates its own copy, which is fine because auth-changing actions
 * (login/register/logout) always happen on a dedicated page and the caller navigates away
 * afterward, remounting whatever reads this hook next with the fresh localStorage value.
 *
 * See apps/api/src/customer-auth/ for the backend this talks to — a bearer token here can
 * never authenticate as staff and is rejected outright if presented against a different
 * organization's slug (see CustomerAuthService.assertSameOrganization).
 */
export function useCustomerAuth(slug: string) {
  const [auth, setAuth] = useState<StoredAuth | null>(null);
  const [hydrated, setHydrated] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- same rationale as useCart's own hydration effect */
  useEffect(() => {
    setAuth(readStoredAuth(slug));
    setHydrated(true);
  }, [slug]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const persist = useCallback(
    (next: StoredAuth | null) => {
      setAuth(next);
      writeStoredAuth(slug, next);
    },
    [slug],
  );

  const register = useCallback(
    async (input: { email: string; password: string; firstName?: string; lastName?: string; phone?: string }) => {
      const result = await publicApiClient.post<CustomerAuthResponse>(
        `/public/${slug}/account/register`,
        input,
      );
      persist(result);
      return result.customer;
    },
    [slug, persist],
  );

  const login = useCallback(
    async (input: { email: string; password: string }) => {
      const result = await publicApiClient.post<CustomerAuthResponse>(
        `/public/${slug}/account/login`,
        input,
      );
      persist(result);
      return result.customer;
    },
    [slug, persist],
  );

  const logout = useCallback(async () => {
    const current = auth;
    persist(null);
    if (current) {
      try {
        await publicApiClient.post(`/public/${slug}/account/logout`, {
          refreshToken: current.refreshToken,
        });
      } catch {
        // Best-effort — the local session is already cleared either way.
      }
    }
  }, [slug, auth, persist]);

  const refresh = useCallback(async (): Promise<string | null> => {
    const current = readStoredAuth(slug);
    if (!current) return null;
    try {
      const tokens = await publicApiClient.post<{ accessToken: string; refreshToken: string }>(
        `/public/${slug}/account/refresh`,
        { refreshToken: current.refreshToken },
      );
      const next = { ...current, ...tokens };
      persist(next);
      return next.accessToken;
    } catch {
      persist(null);
      return null;
    }
  }, [slug, persist]);

  /**
   * Wraps an authenticated call, retrying exactly once with a refreshed access token if the
   * first attempt fails with a 401 (an expired access token is the expected/common case, not
   * an anomaly) — never retries more than once, so an account that's genuinely logged out just
   * surfaces the error.
   */
  const authFetch = useCallback(
    async <T,>(fn: (accessToken: string) => Promise<T>): Promise<T> => {
      const current = readStoredAuth(slug);
      if (!current) {
        throw new PublicApiError("NOT_AUTHENTICATED", "You must be logged in");
      }
      try {
        return await fn(current.accessToken);
      } catch (error) {
        // "UNAUTHORIZED" is Passport's bare rejection for an expired/invalid signature (the
        // common case — access tokens are short-lived by design); "INVALID_CUSTOMER_TOKEN" is
        // this codebase's own explicit typ-claim check in CustomerJwtStrategy.validate. Both
        // are worth exactly one refresh-and-retry before giving up.
        const isAuthError =
          error instanceof PublicApiError &&
          (error.code === "UNAUTHORIZED" || error.code === "INVALID_CUSTOMER_TOKEN");
        if (isAuthError) {
          const refreshed = await refresh();
          if (refreshed) return fn(refreshed);
        }
        throw error;
      }
    },
    [slug, refresh],
  );

  const updateProfile = useCallback(
    async (input: { firstName?: string; lastName?: string; phone?: string }) => {
      const profile = await authFetch((token) =>
        publicApiClient.patch<CustomerProfile>(`/public/${slug}/account/me`, input, token),
      );
      const current = readStoredAuth(slug);
      if (current) persist({ ...current, customer: profile });
      return profile;
    },
    [slug, authFetch, persist],
  );

  return {
    hydrated,
    customer: auth?.customer ?? null,
    isAuthenticated: !!auth,
    register,
    login,
    logout,
    refresh,
    authFetch,
    updateProfile,
  };
}
