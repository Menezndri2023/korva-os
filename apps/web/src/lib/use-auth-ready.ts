import { useAuthStore } from "./auth-store";

/**
 * True once useAuthBootstrap's initial silent refresh has resolved and there's an active
 * organization to scope requests to — the same condition use-analytics.ts and
 * use-active-organization.ts already gate on. Any query that hits an org-scoped endpoint must
 * wait for this before firing, otherwise it races the async bootstrap: it goes out with no
 * Authorization header, gets a real 401, and only succeeds on React Query's automatic retry.
 */
export function useAuthReady(): boolean {
  const bootstrapped = useAuthStore((state) => state.bootstrapped);
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);
  return bootstrapped && Boolean(activeOrganizationId);
}
