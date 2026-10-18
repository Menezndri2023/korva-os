import { PublicApiError } from "@/lib/public-api-client";

/**
 * The three distinguishable answers to "is there a public storefront at this slug?".
 *
 * Collapsing the last two into one `null` is what made every tenant's site tell its visitors
 * "Cette boutique n'existe pas" whenever the API was unreachable — see `classifyLookupFailure`.
 */
export type OrganizationLookup<T> =
  | { kind: "found"; organization: T }
  | { kind: "absent" }
  | { kind: "unavailable" };

/**
 * `ORGANIZATION_NOT_FOUND` — no organization owns this slug.
 * `MODULE_NOT_AVAILABLE` — it exists but has not enabled `website`, so it has no public page.
 *
 * Both mean "there is nothing to show here, and retrying will not change that".
 */
const ABSENT_CODES = new Set(["ORGANIZATION_NOT_FOUND", "MODULE_NOT_AVAILABLE"]);

/**
 * Decides whether a failed storefront lookup means the shop is genuinely absent, or merely that
 * we could not find out.
 *
 * WHY THIS DISTINCTION IS THE WHOLE POINT. Every storefront page used to `return null` on any
 * error at all, and both the page metadata and the client component read that null as "no such
 * shop". So the moment the API became unreachable while the storefront container stayed up —
 * Atlas down, the api container crash-looping, a network partition — every customer's storefront
 * told its visitors the business did not exist. Telling a real shop's customers it is gone is
 * worse than showing them an error, and it is the kind of damage that outlives the outage.
 *
 * A `PublicApiError` means the API answered and said no, so its code can be trusted. Anything
 * else — a thrown fetch, a body that is not JSON, a 5xx, a timeout — means we could not find
 * out, and the only honest answer is "try again shortly".
 *
 * An unrecognised `PublicApiError` code is treated as `unavailable`, not `absent`: failing
 * towards "we don't know" keeps a future API error code from silently declaring live shops dead.
 */
export function classifyLookupFailure(error: unknown): "absent" | "unavailable" {
  if (error instanceof PublicApiError && ABSENT_CODES.has(error.code)) {
    return "absent";
  }
  return "unavailable";
}

/** The metadata title/description pair for a lookup that did not find a storefront. Two
 *  different facts deserve two different sentences: a shop whose API is down has not stopped
 *  existing. `noindex` applies to both — neither state is worth recording. */
export function unresolvedStorefrontMetadata(
  kind: "absent" | "unavailable",
): { title: string; description: string } {
  return kind === "absent"
    ? {
        title: "Boutique introuvable — KORVA OS",
        description: "Cette boutique n'existe pas ou n'est plus disponible.",
      }
    : {
        title: "Boutique momentanément indisponible — KORVA OS",
        description:
          "Cette boutique est temporairement injoignable. Merci de réessayer dans un instant.",
      };
}
