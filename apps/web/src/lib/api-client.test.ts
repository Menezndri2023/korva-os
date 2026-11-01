import "./test-localstorage-shim"; // must load before auth-store.ts — see that file's comment
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getRefreshedAccessToken, apiClient, ApiError } from "./api-client";
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

  it("Test: a network error rejects instead of being treated as success, and keeps the session", async () => {
    // Keeping it matters on a flaky mobile network: a blip used to sign the person out.
    useAuthStore.setState({ accessToken: "stale-token" });
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    await expect(getRefreshedAccessToken()).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().accessToken).toBe("stale-token");
  });

  it("keeps the session when the API is only rate-limiting, ends it when the session is refused", async () => {
    useAuthStore.setState({ accessToken: "stale-token" });
    global.fetch = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: false, error: { code: "TOO_MANY_REQUESTS", message: "slow down" } }, 429),
      ) as unknown as typeof fetch;
    await expect(getRefreshedAccessToken()).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().accessToken).toBe("stale-token");

    global.fetch = vi
      .fn()
      .mockImplementation(() =>
        jsonResponse({ success: false, error: { code: "INVALID_REFRESH_TOKEN", message: "expired" } }, 401),
      ) as unknown as typeof fetch;
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

describe("apiClient.get / getList — envelope unwrapping", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    useAuthStore.setState({
      accessToken: "a-token",
      user: null,
      activeOrganizationId: "org-1",
      bootstrapped: true,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("get() returns just the data, dropping the envelope", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ status: 200, json: () => Promise.resolve({ success: true, data: { id: "c1" } }) }) as unknown as typeof fetch;

    await expect(apiClient.get("/contacts/c1")).resolves.toEqual({ id: "c1" });
  });

  it("getList() returns both the data array and the pagination metadata", async () => {
    const pagination = { page: 1, limit: 20, total: 42, totalPages: 3 };
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({ success: true, data: [{ id: "o1" }, { id: "o2" }], pagination }),
    }) as unknown as typeof fetch;

    await expect(apiClient.getList("/orders")).resolves.toEqual({
      data: [{ id: "o1" }, { id: "o2" }],
      pagination,
    });
  });

  it("getList() throws if the endpoint returns a non-paginated envelope", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ success: true, data: { id: "c1" } }),
    }) as unknown as typeof fetch;

    await expect(apiClient.getList("/contacts/c1")).rejects.toThrow(
      "Expected a paginated list response",
    );
  });

  it("getList() still throws an ApiError on a failed response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 403,
      json: () =>
        Promise.resolve({ success: false, error: { code: "PERMISSION_DENIED", message: "nope" } }),
    }) as unknown as typeof fetch;

    await expect(apiClient.getList("/orders")).rejects.toBeInstanceOf(ApiError);
  });
});
