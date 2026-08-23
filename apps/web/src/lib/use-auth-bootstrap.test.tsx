import "./test-localstorage-shim"; // must load before auth-store.ts — see that file's comment
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { useAuthBootstrap } from "./use-auth-bootstrap";
import { useAuthStore } from "./auth-store";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ status, json: () => Promise.resolve(body) } as Response);
}

describe("useAuthBootstrap", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useAuthStore.setState({
      accessToken: null,
      user: null,
      activeOrganizationId: null,
      bootstrapped: false,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("Test 1: a plain bootstrap issues exactly one /auth/refresh request", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: true, data: { accessToken: "restored-token" } }, 201),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderHook(() => useAuthBootstrap());

    await waitFor(() => expect(useAuthStore.getState().bootstrapped).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBe("restored-token");
  });

  it("Test 2/Strict Mode: the double-invoked effect still issues exactly one /auth/refresh request", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: true, data: { accessToken: "restored-token" } }, 201),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    // <StrictMode> makes React mount -> cleanup -> mount the effect twice, reproducing the
    // exact scenario that used to fire two concurrent POST /auth/refresh calls against the
    // same rotating refresh token (one 201, one 401 — killing the just-restored session).
    renderHook(() => useAuthBootstrap(), { wrapper: StrictMode });

    await waitFor(() => expect(useAuthStore.getState().bootstrapped).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessToken).toBe("restored-token");
  });

  it("Test 5: a successful refresh leaves the session authenticated", async () => {
    global.fetch = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: true, data: { accessToken: "token-abc" } }, 201),
      ) as unknown as typeof fetch;

    renderHook(() => useAuthBootstrap(), { wrapper: StrictMode });

    await waitFor(() => expect(useAuthStore.getState().bootstrapped).toBe(true));
    expect(useAuthStore.getState().accessToken).toBe("token-abc");
  });

  it("Test 4: a real 401 (no valid refresh cookie) leaves the session unauthenticated", async () => {
    global.fetch = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: false, error: { code: "UNAUTHORIZED", message: "no cookie" } }, 401),
      ) as unknown as typeof fetch;

    renderHook(() => useAuthBootstrap(), { wrapper: StrictMode });

    await waitFor(() => expect(useAuthStore.getState().bootstrapped).toBe(true));
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("Test 6: a network error is never treated as a successful login", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    renderHook(() => useAuthBootstrap(), { wrapper: StrictMode });

    await waitFor(() => expect(useAuthStore.getState().bootstrapped).toBe(true));
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
