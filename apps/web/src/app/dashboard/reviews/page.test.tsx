import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import ReviewsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, getList: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getListMock = vi.mocked(apiClient.getList);

const review = {
  id: "review-1",
  organizationId: "org-1",
  contactId: "contact-1",
  entity: "order" as const,
  entityId: "order-1",
  rating: 5,
  comment: "Excellent service !",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

describe("ReviewsPage", () => {
  beforeEach(() => {
    getListMock.mockReset();
  });

  it("renders the rating, comment, and entity label for each review", async () => {
    getListMock.mockResolvedValue({
      data: [review],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    renderWithProviders(<ReviewsPage />);

    expect(await screen.findByText("Excellent service !")).toBeInTheDocument();
    expect(screen.getByText("Commande")).toBeInTheDocument();
    expect(screen.getByLabelText("5 sur 5")).toBeInTheDocument();
  });

  it("shows an empty state when there are no reviews", async () => {
    getListMock.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });
    renderWithProviders(<ReviewsPage />);

    expect(await screen.findByText("Aucun avis pour le moment.")).toBeInTheDocument();
  });

  it("shows a permission message instead of a retry-able error for PERMISSION_DENIED", async () => {
    getListMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "no"));
    renderWithProviders(<ReviewsPage />);

    await waitFor(() =>
      expect(
        screen.getByText("Les avis clients sont réservés aux rôles ayant accès aux commandes."),
      ).toBeInTheDocument(),
    );
  });
});
