import type { ApiListResponse, ApiResponse } from "@korva/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export class PublicApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** Bearer token for the storefront's authenticated customer-portal endpoints
   *  (/public/:slug/account/...) — never sent on any other request. */
  accessToken?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });

  const payload = (await response.json()) as ApiResponse<T> | ApiListResponse<T>;

  if (!payload.success) {
    throw new PublicApiError(payload.error.code, payload.error.message, payload.error.details);
  }

  return payload.data as T;
}

export const publicApiClient = {
  get: <T>(path: string, accessToken?: string) => request<T>(path, { accessToken }),
  post: <T>(path: string, body?: unknown, accessToken?: string) =>
    request<T>(path, { method: "POST", body, accessToken }),
  patch: <T>(path: string, body?: unknown, accessToken?: string) =>
    request<T>(path, { method: "PATCH", body, accessToken }),
};

/**
 * Downloads a binary (PDF) response and triggers a browser save — used for the invoice/
 * certificate endpoints, which need the same bearer-token auth as every other customer-portal
 * call but return `application/pdf`, not the JSON envelope `request()` above expects. A plain
 * `<a href>` can't carry an Authorization header, and a token in the URL would leak into server
 * logs/browser history — fetching as a blob and triggering the save via a short-lived object URL
 * keeps the token exactly where every other authenticated call already keeps it.
 */
export async function downloadPdf(
  path: string,
  accessToken: string,
  filename: string,
): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    let message = "Impossible de télécharger le document.";
    try {
      const payload = (await response.json()) as ApiResponse<unknown>;
      if (!payload.success) message = payload.error.message;
    } catch {
      // Response wasn't JSON (e.g. a raw 401 from the guard) — keep the generic message.
    }
    throw new PublicApiError("DOWNLOAD_FAILED", message);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
