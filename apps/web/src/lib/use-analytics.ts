import { useQuery } from "@tanstack/react-query";
import type {
  AnalyticsActivityEntry,
  AnalyticsOverview,
  AnalyticsRevenueTimeseries,
} from "@korva/types";
import { apiClient } from "./api-client";
import { useAuthStore } from "./auth-store";

interface DateRange {
  from?: string;
  to?: string;
}

function toQueryString(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  return entries.length === 0 ? "" : `?${new URLSearchParams(entries).toString()}`;
}

function useAnalyticsEnabled(): boolean {
  const bootstrapped = useAuthStore((state) => state.bootstrapped);
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);
  return bootstrapped && Boolean(activeOrganizationId);
}

export function useAnalyticsOverview(range: DateRange = {}) {
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);
  const enabled = useAnalyticsEnabled();

  return useQuery({
    queryKey: ["analytics", "overview", activeOrganizationId, range.from, range.to],
    queryFn: () =>
      apiClient.get<AnalyticsOverview>(
        `/analytics/overview${toQueryString({ from: range.from, to: range.to })}`,
      ),
    enabled,
  });
}

export function useAnalyticsRevenue(
  range: DateRange & { interval: "day" | "week" | "month" },
) {
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);
  const enabled = useAnalyticsEnabled();

  return useQuery({
    queryKey: [
      "analytics",
      "revenue",
      activeOrganizationId,
      range.from,
      range.to,
      range.interval,
    ],
    queryFn: () =>
      apiClient.get<AnalyticsRevenueTimeseries>(
        `/analytics/revenue-timeseries${toQueryString({
          from: range.from,
          to: range.to,
          interval: range.interval,
        })}`,
      ),
    enabled,
  });
}

export function useAnalyticsActivity(limit: number) {
  const activeOrganizationId = useAuthStore((state) => state.activeOrganizationId);
  const enabled = useAnalyticsEnabled();

  return useQuery({
    queryKey: ["analytics", "activity", activeOrganizationId, limit],
    queryFn: () =>
      apiClient.get<AnalyticsActivityEntry[]>(`/analytics/activity?limit=${limit}`),
    enabled,
  });
}
