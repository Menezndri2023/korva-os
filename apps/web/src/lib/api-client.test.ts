import "./test-localstorage-shim"; // must load before auth-store.ts — see that file's comment
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getRefreshedAccessToken, ApiError } from "./api-client";
import { useAuthStore } from "./auth-store";

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({ status, json: () => Promise.resolve(body) } as Response);
}

describe("getRefreshedAccessToken — shared refresh dedup", () => {
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

  it("Test: two concurrent callers issue exactly one POST /auth/refresh and both get the same outcome", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: true, data: { accessToken: "fresh-token" } }, 201),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    // Simulates React Strict Mode's double-invoked effect: two "consumers" asking for a
    // refreshed token at the same time — this is exactly the race that used to send two
    // independent requests against the same rotating refresh token.
    const results = await Promise.allSettled([
      getRefreshedAccessToken(),
      getRefreshedAccessToken(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[0].status).toBe("fulfilled");
    expect(results[1].status).toBe("fulfilled");
    expect(useAuthStore.getState().accessToken).toBe("fresh-token");
  });

  it("Test: a real 401 rejects every concurrent caller and clears the session — never fakes success", async () => {
    useAuthStore.setState({ accessToken: "stale-token" });
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: false, error: { code: "UNAUTHORIZED", message: "expired" } }, 401),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const results = await Promise.allSettled([
      getRefreshedAccessToken(),
      getRefreshedAccessToken(),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("Test: a successful refresh restores an authenticated session", async () => {
    global.fetch = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: true, data: { accessToken: "restored-token" } }, 201),
      ) as unknown as typeof fetch;

    await getRefreshedAccessToken();

    expect(useAuthStore.getState().accessToken).toBe("restored-token");
  });

  it("Test: a network error rejects and clears the session instead of being treated as success", async () => {
    useAuthStore.setState({ accessToken: "stale-token" });
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    await expect(getRefreshedAccessToken()).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it("a later, independent call after a completed refresh issues a brand new request (dedup doesn't stick forever)", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: true, data: { accessToken: "token" } }, 201),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    await getRefreshedAccessToken();
    await getRefreshedAccessToken();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
