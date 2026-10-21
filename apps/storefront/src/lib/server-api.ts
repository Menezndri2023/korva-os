import { headers } from "next/headers";
import type { Pagination } from "@korva/types";
import { request } from "./public-api-client";

/**
 * The storefront SERVER's way to the API — for pages it renders, the sitemap, never the browser.
 *
 * Two things differ from publicApiClient:
 *  - it calls the API on the private network (API_INTERNAL_URL, e.g. http://api:4000/api/v1)
 *    instead of going out to the public address and back in through Caddy;
 *  - it passes the visitor's address in X-Forwarded-For. Every page the storefront renders is an
 *    API call from this one server, so without it all visitors of all sites shared a single
 *    rate-limit bucket at the API — a few dozen page views a minute, platform-wide, and sites
 *    answered "momentanément indisponible". The API trusts that header only from private peers
 *    (configureProxyTrust in apps/api).
 */
const INTERNAL_URL = process.env.API_INTERNAL_URL;

/** The address Caddy saw for this visitor: the right-most X-Forwarded-For entry it set. */
export function visitorAddress(forwardedFor: string | null | undefined): string | undefined {
  const entries = (forwardedFor ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return entries.at(-1);
}

async function currentVisitor(): Promise<string | undefined> {
  try {
    return visitorAddress((await headers()).get("x-forwarded-for"));
  } catch {
    // Outside a request (build time): there is no visitor to forward.
    return undefined;
  }
}

export const serverApi = {
  get: async <T>(path: string) =>
    request<T>(path, { baseUrl: INTERNAL_URL, forwardedFor: await currentVisitor() }).then(
      (payload) => payload.data as T,
    ),
  getList: async <T>(path: string) =>
    request<T>(path, { baseUrl: INTERNAL_URL, forwardedFor: await currentVisitor() }).then(
      (payload) => ({ data: payload.data as T[], pagination: (payload as { pagination?: Pagination }).pagination }),
    ),
};
