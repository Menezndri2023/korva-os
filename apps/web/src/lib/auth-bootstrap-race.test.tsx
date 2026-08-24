import "./test-localstorage-shim"; // must load before auth-store.ts — see that file's comment
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { useAuthBootstrap } from "./use-auth-bootstrap";
import { useAuthReady } from "./use-auth-ready";
import { useAuthStore } from "./auth-store";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ status, json: () => Promise.resolve(body) } as Response);
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/**
 * Stands in for a real dashboard page's primary query: gated on useAuthReady(), same as every
 * page touched by Bug #6. protectedFetch is the spy under test — it plays the role of
 * apiClient.get, and records the accessToken that was actually in the store at call time so
 * tests can assert a token was always present when the "request" went out.
 */
function useProtectedResource(protectedFetch: (token: string | null) => Promise<unknown>) {
  useAuthBootstrap();
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ["protected-resource"],
    queryFn: () => protectedFetch(useAuthStore.getState().accessToken),
    enabled: authReady,
  });
}

describe("dashboard query vs. auth bootstrap race (Bug #6)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      activeOrganizationId: "org-1", // simulates a returning, already-onboarded user
      bootstrapped: false,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("A/B/D — the protected query does not fire until bootstrap resolves, and always sees a token once it does", async () => {
    global.fetch = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: true, data: { accessToken: "restored-token" } }, 201),
      ) as unknown as typeof fetch;

    const protectedFetch = vi.fn().mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useProtectedResource(protectedFetch), { wrapper });

    // Immediately after mount, bootstrap is still in flight — the query must not have fired.
    expect(protectedFetch).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).not.toBe("fetching");

    await waitFor(() => expect(useAuthStore.getState().bootstrapped).toBe(true));
    await waitFor(() => expect(protectedFetch).toHaveBeenCalledTimes(1));

    // D — the token was actually present in the store at the moment the query ran.
    expect(protectedFetch).toHaveBeenCalledWith("restored-token");
  });

  it("C — no artificial 401 reaches the query: the mocked resource endpoint is never called with a null token", async () => {
    global.fetch = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: true, data: { accessToken: "restored-token" } }, 201),
      ) as unknown as typeof fetch;

    const protectedFetch = vi.fn().mockImplementation((token: string | null) => {
      if (!token) {
        // Mirrors what the real backend does when Authorization is missing.
        return Promise.reject(new Error("401 UNAUTHORIZED"));
      }
      return Promise.resolve({ ok: true });
    });

    renderHook(() => useProtectedResource(protectedFetch), { wrapper });

    await waitFor(() => expect(protectedFetch).toHaveBeenCalledTimes(1));
    // Every call the resource endpoint ever received carried a real token — none raced ahead
    // of bootstrap with token = null.
    for (const call of protectedFetch.mock.calls) {
      expect(call[0]).not.toBeNull();
    }
  });

  it("F — a failed bootstrap (no session) leaves the protected query disabled, not erroring", async () => {
    global.fetch = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: false, error: { code: "UNAUTHORIZED", message: "no cookie" } }, 401),
      ) as unknown as typeof fetch;
    // No active organization either — matches a genuinely logged-out visitor.
    useAuthStore.setState({ activeOrganizationId: null });

    const protectedFetch = vi.fn().mockResolvedValue({ ok: true });

    const { result } = renderHook(() => useProtectedResource(protectedFetch), { wrapper });

    await waitFor(() => expect(useAuthStore.getState().bootstrapped).toBe(true));

    expect(protectedFetch).not.toHaveBeenCalled();
    expect(result.current.isError).toBe(false);
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("G — a genuine API error (not the bootstrap race) still propagates once the query is allowed to run", async () => {
    global.fetch = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: true, data: { accessToken: "restored-token" } }, 201),
      ) as unknown as typeof fetch;

    const protectedFetch = vi.fn().mockRejectedValue(new Error("500 SOMETHING_BROKE"));

    const { result } = renderHook(() => useProtectedResource(protectedFetch), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toEqual(new Error("500 SOMETHING_BROKE"));
  });
});
