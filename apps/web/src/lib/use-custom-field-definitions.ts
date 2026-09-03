import { useQuery } from "@tanstack/react-query";
import type { CustomField, CustomFieldEntity } from "@korva/types";
import { apiClient } from "@/lib/api-client";
import { useAuthReady } from "@/lib/use-auth-ready";

export function useCustomFieldDefinitions(entity: CustomFieldEntity) {
  const authReady = useAuthReady();
  return useQuery({
    queryKey: ["custom-fields", entity],
    queryFn: () => apiClient.get<CustomField[]>(`/custom-fields?entity=${entity}`),
    enabled: authReady,
  });
}
