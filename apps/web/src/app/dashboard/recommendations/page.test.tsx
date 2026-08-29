import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecommendationsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, getList: vi.fn(), post: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);

const recommendation = {
  id: "rec-1",
  ruleKey: "customer_reactivation",
  title: "Client inactif à relancer",
  description: "Ce client n'a montré aucune activité depuis 61 jours.",
  entityType: "contact",
  entityId: "contact-1",
  status: "open",
  createdAt: "2026-01-01T00:00:00.000Z",
};

function mockRecommendationsPage(
  recommendations: unknown[],
  pagination = { page: 1, limit: 20, total: recommendations.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/recommendations")) {
      return Promise.resolve({ data: recommendations, pagination });
    }
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("RecommendationsPage", () => {
  beforeEach(() => {
    getListMock.mockReset();
    postMock.mockReset();
    mockRecommendationsPage([]);
  });

  it("renders the empty state when there are no recommendations", async () => {
    renderWithProviders(<RecommendationsPage />);
    expect(
      await screen.findByText("Aucune recommandation pour le moment."),
    ).toBeInTheDocument();
  });

  it("renders a recommendation's title and description", async () => {
    mockRecommendationsPage([recommendation]);
    renderWithProviders(<RecommendationsPage />);
    expect(await screen.findByText("Client inactif à relancer")).toBeInTheDocument();
    expect(
      await screen.findByText("Ce client n'a montré aucune activité depuis 61 jours."),
    ).toBeInTheDocument();
  });

  it("defaults to filtering by the open status", async () => {
    renderWithProviders(<RecommendationsPage />);
    await waitFor(() =>
      expect(getListMock).toHaveBeenCalledWith("/recommendations?page=1&status=open"),
    );
  });

  it("switching to the 'Toutes' filter fetches without a status param", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RecommendationsPage />);
    await waitFor(() =>
      expect(getListMock).toHaveBeenCalledWith("/recommendations?page=1&status=open"),
    );

    await user.click(screen.getByRole("button", { name: "Toutes" }));

    await waitFor(() =>
      expect(getListMock).toHaveBeenCalledWith("/recommendations?page=1"),
    );
  });

  it("resolving an open recommendation calls the resolve endpoint and refreshes the list", async () => {
    mockRecommendationsPage([recommendation]);
    postMock.mockResolvedValue({ ...recommendation, status: "resolved" });
    const user = userEvent.setup();
    renderWithProviders(<RecommendationsPage />);

    await screen.findByText("Client inactif à relancer");
    await user.click(screen.getByRole("button", { name: "Résolue" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/recommendations/rec-1/resolve"),
    );
  });

  it("dismissing an open recommendation calls the dismiss endpoint", async () => {
    mockRecommendationsPage([recommendation]);
    postMock.mockResolvedValue({ ...recommendation, status: "dismissed" });
    const user = userEvent.setup();
    renderWithProviders(<RecommendationsPage />);

    await screen.findByText("Client inactif à relancer");
    await user.click(screen.getByRole("button", { name: "Ignorer" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/recommendations/rec-1/dismiss"),
    );
  });

  it("does not show resolve/dismiss actions for a recommendation that isn't open", async () => {
    mockRecommendationsPage([{ ...recommendation, status: "resolved" }]);
    renderWithProviders(<RecommendationsPage />);

    await screen.findByText("Client inactif à relancer");
    expect(screen.queryByRole("button", { name: "Résolue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ignorer" })).not.toBeInTheDocument();
  });

  it("shows an error message with a retry action when the fetch fails", async () => {
    getListMock.mockRejectedValue(new Error("network error"));
    const user = userEvent.setup();
    renderWithProviders(<RecommendationsPage />);

    expect(
      await screen.findByText("Impossible de charger les recommandations."),
    ).toBeInTheDocument();

    mockRecommendationsPage([recommendation]);
    await user.click(screen.getByRole("button", { name: "Réessayer" }));

    expect(await screen.findByText("Client inactif à relancer")).toBeInTheDocument();
  });
});
