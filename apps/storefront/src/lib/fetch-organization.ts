import { cache } from "react";
import { serverApi } from "@/lib/server-api";
import { classifyLookupFailure, type OrganizationLookup } from "@/lib/organization-lookup";
import type { PublicOrganization } from "@/lib/public-types";
import { siteLocale, translator, type Translate } from "@/lib/storefront-locale-core";

/**
 * Wrapped in React's `cache()` so the site's layout, generateMetadata and the page body share ONE
 * call per request. serverApi sends `cache: "no-store"`, which opts out of Next's fetch
 * memoization, so without this the organization was fetched several times for every page view.
 */
export const fetchOrganization = cache(
  async (slug: string): Promise<OrganizationLookup<PublicOrganization>> => {
    try {
      const organization = await serverApi.get<PublicOrganization>(`/public/${slug}`);
      return { kind: "found", organization };
    } catch (error) {
      // See classifyLookupFailure: "the API said no" and "we could not ask" must not collapse
      // into one answer, because the second one used to render as the first.
      return { kind: classifyLookupFailure(error) };
    }
  },
);

/** The site's translator for server code (page metadata), from the business's language. */
export async function siteTranslator(slug: string): Promise<Translate> {
  const lookup = await fetchOrganization(slug);
  return translator(siteLocale(lookup.kind === "found" ? lookup.organization.language : undefined));
}
