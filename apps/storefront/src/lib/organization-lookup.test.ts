import { describe, expect, it } from "vitest";
import { PublicApiError } from "@/lib/public-api-client";
import {
  classifyLookupFailure,
  unresolvedStorefrontMetadata,
} from "@/lib/organization-lookup";

/**
 * The regression these guard against is not a crash — it is a sentence. Every storefront page
 * used to treat any lookup failure as "this shop does not exist", so an unreachable API turned
 * every customer's storefront into a notice that their business was gone.
 */
describe("classifyLookupFailure", () => {
  it("treats the API's own not-found codes as genuinely absent", () => {
    for (const code of ["ORGANIZATION_NOT_FOUND", "MODULE_NOT_AVAILABLE"]) {
      expect(
        classifyLookupFailure(new PublicApiError(code, "nope")),
      ).toBe("absent");
    }
  });

  it("treats an unreachable API as unavailable, never as absent", () => {
    // What a thrown `fetch` actually looks like: not a PublicApiError at all.
    for (const error of [
      new TypeError("fetch failed"),
      new Error("ECONNREFUSED"),
      new SyntaxError("Unexpected token < in JSON at position 0"), // an HTML 502 page
      undefined,
      null,
      "a string someone threw",
    ]) {
      expect(classifyLookupFailure(error)).toBe("unavailable");
    }
  });

  it("treats an API error that is NOT a not-found as unavailable", () => {
    // A 500 from the API still answers in the envelope shape, so it arrives as a
    // PublicApiError — but it says nothing about whether the shop exists.
    expect(
      classifyLookupFailure(
        new PublicApiError("INTERNAL_SERVER_ERROR", "Unexpected error"),
      ),
    ).toBe("unavailable");
  });

  it("fails towards 'unavailable' for a code it has never seen", () => {
    // The direction of this default is deliberate. A new API error code must not be able to
    // declare live shops dead; at worst it shows a retry message for something permanent.
    expect(
      classifyLookupFailure(new PublicApiError("SOME_FUTURE_CODE", "?")),
    ).toBe("unavailable");
  });
});

describe("unresolvedStorefrontMetadata", () => {
  it("says the shop does not exist only when it genuinely does not", () => {
    const absent = unresolvedStorefrontMetadata("absent");
    expect(absent.title).toContain("introuvable");
    expect(absent.description).toContain("n'existe pas");
  });

  it("never claims non-existence when we simply could not reach the API", () => {
    const unavailable = unresolvedStorefrontMetadata("unavailable");
    expect(unavailable.description).not.toContain("n'existe pas");
    expect(unavailable.description).toContain("réessayer");
    expect(unavailable.title).toContain("indisponible");
  });

  it("produces different text for the two cases, which is the entire point", () => {
    expect(unresolvedStorefrontMetadata("absent")).not.toEqual(
      unresolvedStorefrontMetadata("unavailable"),
    );
  });
});
