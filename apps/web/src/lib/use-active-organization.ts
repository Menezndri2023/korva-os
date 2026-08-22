import { useQuery } from "@tanstack/react-query";
import type { Organization } from "@korva/types";
import { apiClient } from "./api-client";
import { useAuthStore } from "./auth-store";

export function useActiveOrganization() {
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);
  const bootstrapped = useAuthStore((state) => state.bootstrapped);

  return useQuery({
    queryKey: ["organizations", "me", activeOrganizationId],
    queryFn: () => apiClient.get<Organization>("/organizations/me"),
    // Wait for useAuthBootstrap to recover an access token first, otherwise this fires with
    // no Authorization header and 401s on every fresh page load.
    enabled: bootstrapped && Boolean(activeOrganizationId),
  });
}
