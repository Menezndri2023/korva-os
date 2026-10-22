import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReviewsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, getList: vi.fn(), get: vi.fn(), patch: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getListMock = vi.mocked(apiClient.getList);
const getMock = vi.mocked(apiClient.get);
const patchMock = vi.mocked(apiClient.patch);

const review = {
  id: "review-1",
  organizationId: "org-1",
  contactId: "contact-1",
  entity: "order" as const,
  entityId: "order-1",
  rating: 5,
  comment: "Excellent service !",
  authorName: "Awa K.",
  offerName: "Attiéké poisson",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

const stats = {
  average: 4.4,
  count: 2,
  hidden: 0,
  distribution: [0, 0, 0, 1, 1],
  requestsEnabled: true,
};

function listOf(data: unknown[]) {
  return { data, pagination: { page: 1, limit: 20, total: data.length, totalPages: 1 } };
}

describe("ReviewsPage", () => {
  beforeEach(() => {
    getListMock.mockReset();
    getMock.mockReset();
    patchMock.mockReset();
    getMock.mockResolvedValue(stats);
    patchMock.mockResolvedValue({});
  });

  it("renders each review with who wrote it and what it was about", async () => {
    getListMock.mockResolvedValue(listOf([review]) as never);
    renderWithProviders(<ReviewsPage />);

    expect(await screen.findByText("Excellent service !")).toBeInTheDocument();
    expect(screen.getByText("Commande")).toBeInTheDocument();
    expect(screen.getByText("Awa K. · Attiéké poisson")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "5 sur 5" })).toBeInTheDocument();
    expect(await screen.findByText("2 avis")).toBeInTheDocument();
  });

  it("answers a review publicly and takes one off the site", async () => {
    getListMock.mockResolvedValue(listOf([review]) as never);
    renderWithProviders(<ReviewsPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Répondre" }));
    await user.type(screen.getByLabelText(/Réponse publique/), "Merci Awa !");
    await user.click(screen.getByRole("button", { name: "Publier la réponse" }));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/reviews/review-1/reply", { body: "Merci Awa !" }),
    );

    await user.click(screen.getByRole("button", { name: "Masquer du site" }));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/reviews/review-1/status", { status: "hidden" }),
    );
  });

  it("switches automatic review requests off", async () => {
    getListMock.mockResolvedValue(listOf([]) as never);
    renderWithProviders(<ReviewsPage />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("switch"));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", { reviewRequestsEnabled: false }),
    );
  });

  it("shows an empty state when there are no reviews", async () => {
    getListMock.mockResolvedValue(listOf([]) as never);
    renderWithProviders(<ReviewsPage />);

    expect(await screen.findByText("Aucun avis pour le moment.")).toBeInTheDocument();
  });

  it("shows a permission message instead of a retry-able error for PERMISSION_DENIED", async () => {
    getListMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "no"));
    getMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "no"));
    renderWithProviders(<ReviewsPage />);

    await waitFor(() =>
      expect(
        screen.getByText("Les avis clients sont réservés aux rôles ayant accès aux commandes."),
      ).toBeInTheDocument(),
    );
  });
});
