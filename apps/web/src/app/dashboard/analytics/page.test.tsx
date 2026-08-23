import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import AnalyticsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn() } };
});

vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ bootstrapped: true, activeOrganizationId: "org-1" }),
}));

const getMock = vi.mocked(apiClient.get);

const overviewWithData = {
  leads: { total: 5, byStatus: { open: 3, won: 2 } },
  bookings: { total: 4, upcoming: 2 },
  orders: { total: 3, byStatus: { confirmed: 3 }, revenue: 1500, currency: "EUR" },
  invoices: { total: 2, byStatus: { issued: 2 }, outstanding: 400, currency: "EUR" },
};

const emptyOverview = {
  leads: { total: 0, byStatus: {} },
  bookings: { total: 0, upcoming: 0 },
  orders: { total: 0, byStatus: {}, revenue: 0, currency: null },
  invoices: { total: 0, byStatus: {}, outstanding: 0, currency: null },
};

function mockGetByPath(overview: unknown, revenuePoints: unknown[], activity: unknown[]) {
  return (path: string) => {
    if (path.startsWith("/analytics/overview")) return Promise.resolve(overview);
    if (path.startsWith("/analytics/revenue-timeseries"))
      return Promise.resolve({ points: revenuePoints, currency: "EUR" });
    if (path.startsWith("/analytics/activity")) return Promise.resolve(activity);
    throw new Error(`unexpected GET ${path}`);
  };
}

describe("AnalyticsPage", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("renders real KPI values and the revenue chart once data loads", async () => {
    getMock.mockImplementation(
      mockGetByPath(overviewWithData, [{ date: "2026-08-01", revenue: 1500 }], []),
    );

    renderWithProviders(<AnalyticsPage />);

    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(screen.getAllByText(/1\s?500/).length).toBeGreaterThan(0);
  });

  it("shows an explicit empty state instead of fabricated numbers when an org has no data yet", async () => {
    getMock.mockImplementation(mockGetByPath(emptyOverview, [], []));

    renderWithProviders(<AnalyticsPage />);

    await waitFor(() =>
      expect(screen.getByText("Aucune donnée disponible pour cette période")).toBeInTheDocument(),
    );
    expect(screen.getByText("Aucune activité récente")).toBeInTheDocument();
  });

  it("shows an error state with a retry action when the overview request fails", async () => {
    getMock.mockImplementation(() => Promise.reject(new Error("network down")));

    renderWithProviders(<AnalyticsPage />);

    await waitFor(() =>
      expect(screen.getByText("Impossible de charger les statistiques.")).toBeInTheDocument(),
    );
    expect(screen.getByText("Réessayer")).toBeInTheDocument();
  });
});
