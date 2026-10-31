import type { ApiListResponse, ApiListSuccess, ApiResponse, ApiSuccess, Pagination } from "@korva/types";
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
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
  return new ApiError(
    payload.error.code,
    planLimitMessage(payload.error.code, payload.error.details) ?? payload.error.message,
    payload.error.details,
  );
}

const PLAN_LIMIT_SUBJECTS: Record<string, string> = {
  offers: "offres au catalogue",
  bookable_staff: "membres d'équipe réservables",
  workflows: "automatisations",
};

/**
 * The owner-facing French wording of the two plan-limit refusals, which every create form shows
 * as-is. The API's own messages are English and say nothing about what to do next; these name
 * the limit and the way out (a higher plan, or an extra user once that can be bought).
 */
export function planLimitMessage(code: string, details: unknown): string | undefined {
  const d = (details ?? {}) as {
    metric?: string;
    limit?: number;
    extraSeat?: { price: number | null; currency: string; purchasable: boolean };
  };
  if (code === "PLAN_LIMIT_REACHED" && d.metric && d.limit != null) {
    const subject = PLAN_LIMIT_SUBJECTS[d.metric] ?? d.metric;
    return `Votre formule permet ${d.limit} ${subject}. Passez à la formule supérieure pour en ajouter.`;
  }
  if (code === "USAGE_LIMIT_REACHED" && d.metric === "ai_messages_per_month" && d.limit != null) {
    return `Vous avez utilisé vos ${d.limit} messages KORVA IA de ce mois. Ils reviennent le 1er du mois prochain ; pour en avoir plus, passez à la formule supérieure.`;
  }
  if (code === "SEAT_LIMIT_REACHED" && d.limit != null) {
    const base = `Votre formule permet ${d.limit} utilisateur${d.limit > 1 ? "s" : ""} du tableau de bord.`;
    const extra = d.extraSeat;
    if (!extra || extra.price == null) return `${base} Passez à la formule supérieure.`;
    const price = `${extra.price} ${extra.currency}/mois`;
    return extra.purchasable
      ? `${base} Ajoutez un utilisateur pour ${price}, ou passez à la formule supérieure.`
      : `${base} L'utilisateur supplémentaire (${price}) arrive bientôt ; en attendant, passez à la formule supérieure. Vos coiffeurs, coachs ou formateurs réservables n'ont pas besoin de compte.`;
  }
  return undefined;
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

/**
 * Ensures at most one refresh is in flight at a time; every concurrent caller — a 401 retry
 * or useAuthBootstrap's initial silent refresh — awaits this same promise instead of firing
 * its own request. Exported so useAuthBootstrap can share it rather than calling
 * POST /auth/refresh directly, which used to bypass this dedup and let React Strict Mode's
 * double-invoked effect fire two concurrent refreshes against the same (rotating) refresh
 * token — one winning, the other 401ing and wiping the just-restored session.
 */
export function getRefreshedAccessToken(): Promise<void> {
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
): Promise<ApiSuccess<T> | ApiListSuccess<T>> {
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

  return payload;
}

interface UploadResult {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Multipart file upload against POST /uploads (apps/api/src/shared/storage/uploads.controller.ts)
 * — a separate function from `request()` above because that one always JSON.stringifies its body
 * and forces `Content-Type: application/json`, neither of which a multipart upload can use (the
 * browser must set its own `Content-Type: multipart/form-data; boundary=...`, never a manual one).
 * Deliberately skips `request()`'s silent 401-refresh-and-retry dance for simplicity — an upload
 * is a rare, user-initiated action with its own visible loading/error state, so surfacing "please
 * try again" on an expired token is an acceptable trade-off here, unlike the many-small-reads
 * pattern that dance exists for elsewhere.
 */
export async function uploadFile(file: File): Promise<UploadResult> {
  const { accessToken, activeOrganizationId } = useAuthStore.getState();
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (activeOrganizationId) headers["X-Organization-Id"] = activeOrganizationId;

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/uploads`, {
    method: "POST",
    headers,
    body: formData,
    credentials: "include",
  });
  const payload = (await response.json()) as ApiResponse<UploadResult>;
  if (!payload.success) {
    throw toApiError(payload);
  }
  return payload.data;
}

export const apiClient = {
  get: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }).then((payload) => payload.data as T),
  // For a paginated list endpoint (GET /orders, /invoices, ...): T is the item type (matching
  // ApiListSuccess<T>.data: T[]), not the array itself — unlike get<T>() above, where T is the
  // full response shape. Throws if the endpoint didn't actually return a paginated envelope.
  getList: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "GET" }).then((payload) => {
      if (!("pagination" in payload)) {
        throw new Error(`Expected a paginated list response from ${path}`);
      }
      return { data: payload.data, pagination: payload.pagination as Pagination };
    }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "POST", body }).then((payload) => payload.data as T),
  patch: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PATCH", body }).then((payload) => payload.data as T),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "PUT", body }).then((payload) => payload.data as T),
  delete: <T>(path: string, options?: Omit<RequestOptions, "method" | "body">) =>
    request<T>(path, { ...options, method: "DELETE" }).then((payload) => payload.data as T),
};
