import { useQuery } from "@tanstack/react-query";
import { publicApiClient } from "./public-api-client";
import type { PublicOrganization } from "./public-types";

/** The shop's public profile, sharing the ["public-org", slug] cache the storefront page fills. */
export function usePublicOrganization(slug: string) {
  return useQuery({
    queryKey: ["public-org", slug],
    queryFn: () => publicApiClient.get<PublicOrganization>(`/public/${slug}`),
    retry: false,
  });
}
