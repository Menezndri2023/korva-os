import type { ApiListResponse, ApiResponse } from "@korva/types";
import { useAuthStore } from "./auth-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";
const REFRESH_PATH = "/auth/refresh";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  withOrganization?: boolean;
}

interface RefreshResponse {
  accessToken: string;
}

function toApiError(payload: ApiResponse<unknown> | ApiListResponse<unknown>): ApiError {
  if (payload.success) {
    // Unreachable in practice — only ever called on a response we already know failed.
    return new ApiError("UNKNOWN_ERROR", "Unknown error");
  }
  return new ApiError(payload.error.code, payload.error.message, payload.error.details);
}

// Shared by every concurrent 401 so at most one POST /auth/refresh is ever in flight — every
// request that hits an expired access token awaits this same promise instead of firing its
// own refresh call. Reset to null once settled so the *next* expiry starts a fresh attempt.
let refreshPromise: Promise<void> | null = null;

async function refreshAccessToken(): Promise<void> {
  // Snapshot so we can detect whether logout (or a fresh, unrelated login) happened while this
  // request was in flight — see the check below.
  const tokenBeforeRefresh = useAuthStore.getState().accessToken;

  let payload: ApiResponse<RefreshResponse>;
  try {
    const response = await fetch(`${API_URL}${REFRESH_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    payload = (await response.json()) as ApiResponse<RefreshResponse>;
  } catch {
    useAuthStore.getState().clear();
    throw new ApiError("NETWORK_ERROR", "Unable to reach the server");
  }

  if (!payload.success) {
    useAuthStore.getState().clear();
    throw toApiError(payload);
  }

  // Something else already changed the auth state while we were waiting on the network — most
  // likely the user logged out, or a completely separate login happened. Never resurrect a
  // session over an explicit logout, and never clobber a newer token with this now-stale one:
  // just leave whatever is currently in the store alone.
  if (useAuthStore.getState().accessToken !== tokenBeforeRefresh) {
    return;
  }

  useAuthStore.getState().setAccessToken(payload.data.accessToken);
}

/** Ensures at most one refresh is in flight at a time; every concurrent 401 awaits it. */
function getRefreshedAccessToken(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<T> {
  const { accessToken, activeOrganizationId } = useAuthStore.getState();
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (options.withOrganization !== false && activeOrganizationId) {
    headers["X-Organization-Id"] = activeOrganizationId;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    // Required for the HttpOnly refresh-token cookie to be sent/received on requests to the
    // API's (different) origin — see auth-store.ts / use-auth-bootstrap.ts.
    credentials: "include",
  });

  const payload = (await response.json()) as ApiResponse<T> | ApiListResponse<T>;

  // Silent refresh-and-retry: only for a genuinely authenticated call (we actually sent a
  // Bearer token) whose token the API just rejected. Excludes the refresh endpoint itself
  // (would recurse) and only ever fires once per original call (isRetry) — a still-401 retry
  // falls straight through to the normal error below instead of looping.
  if (response.status === 401 && !isRetry && accessToken && path !== REFRESH_PATH) {
    try {
      await getRefreshedAccessToken();
    } catch {
      // Refresh itself failed (or the network dropped) — surface the ORIGINAL 401, not a
      // synthetic one, so the caller sees the real reason the request failed.
      throw toApiError(payload);
    }
    return request<T>(path, options, true);
  }

  if (!payload.success) {
    throw toApiError(payload);
  }

  return payload.data as T;
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body }),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PATCH", body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "DELETE" }),
};
