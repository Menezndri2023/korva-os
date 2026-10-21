import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import DashboardPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn() } };
});

vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ bootstrapped: true, activeOrganizationId: "org-1", user: { firstName: "Ada" } }),
}));

vi.mock("@/lib/use-active-organization", () => ({
  useActiveOrganization: () => ({
    data: { name: "Org de test", enabledModules: ["analytics", "crm"] },
    isLoading: false,
  }),
}));

const getMock = vi.mocked(apiClient.get);

const overviewWithData = {
  leads: { total: 3, byStatus: { open: 3 } },
  bookings: { total: 2, upcoming: 1 },
  orders: { total: 1, byStatus: { confirmed: 1 }, revenue: 500, currency: "EUR" },
  invoices: { total: 1, byStatus: { issued: 1 }, outstanding: 100, currency: "EUR" },
};

const emptyOverview = {
  leads: { total: 0, byStatus: {} },
  bookings: { total: 0, upcoming: 0 },
  orders: { total: 0, byStatus: {}, revenue: 0, currency: null },
  invoices: { total: 0, byStatus: {}, outstanding: 0, currency: null },
};

const zeroActionSummary = {
  pendingApprovals: 0,
  recommendations: 0,
  automatedThisWeek: 0,
  failures: 0,
};

function mockGetByPath(
  overview: unknown,
  activity: unknown[],
  actionSummary: unknown = zeroActionSummary,
  actionFeed: unknown[] = [],
) {
  return (path: string) => {
    if (path.startsWith("/analytics/overview")) return Promise.resolve(overview);
    if (path.startsWith("/analytics/activity")) return Promise.resolve(activity);
    if (path.startsWith("/action-center/summary")) return Promise.resolve(actionSummary);
    if (path.startsWith("/action-center/feed")) return Promise.resolve(actionFeed);
    throw new Error(`unexpected GET ${path}`);
  };
}

describe("DashboardPage", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("shows real summary values and recent activity once data loads", async () => {
    getMock.mockImplementation(
      mockGetByPath(overviewWithData, [
        { id: "log-1", action: "CREATE", entity: "lead", createdAt: "2026-08-20T10:00:00.000Z" },
      ]),
    );

    renderWithProviders(<DashboardPage />);

    await waitFor(() => expect(screen.getByText("3")).toBeInTheDocument());
    expect(screen.getAllByText(/Prospect/).length).toBeGreaterThan(0);
  });

  it("shows a clean welcome empty state for a brand-new organization, never fabricated numbers", async () => {
    getMock.mockImplementation(mockGetByPath(emptyOverview, []));

    renderWithProviders(<DashboardPage />);

    await waitFor(() =>
      expect(screen.getByText("Vos chiffres apparaîtront ici")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Prospects")).not.toBeInTheDocument();
  });

  it("treats a PERMISSION_DENIED overview error as a permission boundary, not a retryable failure", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/analytics/overview")) {
        return Promise.reject(new ApiError("PERMISSION_DENIED", "forbidden"));
      }
      return Promise.reject(new ApiError("PERMISSION_DENIED", "forbidden"));
    });

    renderWithProviders(<DashboardPage />);

    await waitFor(() =>
      expect(
        screen.getByText("Les statistiques globales de l'organisation sont réservées aux administrateurs."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Réessayer")).not.toBeInTheDocument();
  });

  it("treats a MODULE_NOT_ENABLED overview error as a settings prompt, not a retryable failure — an org that disabled Statistiques must still land on a working dashboard", async () => {
    getMock.mockImplementation(() =>
      Promise.reject(new ApiError("MODULE_NOT_ENABLED", "module not enabled")),
    );

    renderWithProviders(<DashboardPage />);

    await waitFor(() =>
      expect(
        screen.getByText("Activez le module Statistiques pour voir un résumé de votre activité ici."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("Réessayer")).not.toBeInTheDocument();
    expect(screen.queryByText("Impossible de charger l'activité de votre organisation.")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir les paramètres" })).toHaveAttribute(
      "href",
      "/dashboard/settings#abonnement",
    );
  });

  it("shows an all-clear message when nothing needs attention", async () => {
    getMock.mockImplementation(mockGetByPath(emptyOverview, []));

    renderWithProviders(<DashboardPage />);

    expect(
      await screen.findByText("Rien ne nécessite votre attention pour le moment — tout est sous contrôle."),
    ).toBeInTheDocument();
  });

  it("previews pending action-center items and links to the full Action Center", async () => {
    getMock.mockImplementation(
      mockGetByPath(
        emptyOverview,
        [],
        { pendingApprovals: 1, recommendations: 2, automatedThisWeek: 5, failures: 0 },
        [
          {
            type: "recommendation",
            id: "rec-1",
            title: "Relancer un client inactif",
            occurredAt: "2026-08-20T10:00:00.000Z",
          },
        ],
      ),
    );

    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("Relancer un client inactif")).toBeInTheDocument();
    expect(
      screen.queryByText("Rien ne nécessite votre attention pour le moment — tout est sous contrôle."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir le centre d'action" })).toHaveAttribute(
      "href",
      "/dashboard/action-center",
    );
  });
});
