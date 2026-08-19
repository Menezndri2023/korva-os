import { useQuery } from "@tanstack/react-query";
import type { Organization } from "@korva/types";
import { apiClient } from "./api-client";
import { useAuthStore } from "./auth-store";

export function useActiveOrganization() {
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);

  return useQuery({
    queryKey: ["organizations", "me", activeOrganizationId],
    queryFn: () => apiClient.get<Organization>("/organizations/me"),
    enabled: Boolean(activeOrganizationId),
  });
}
