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
