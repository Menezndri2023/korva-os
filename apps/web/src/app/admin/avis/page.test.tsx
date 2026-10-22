import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import AdminReviewsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { adminApi } from "@/lib/platform-admin";

vi.mock("@/lib/platform-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-admin")>();
  return { ...actual, adminApi: { get: vi.fn(), post: vi.fn(), getList: vi.fn() } };
});

const getMock = vi.mocked(adminApi.get);
const postMock = vi.mocked(adminApi.post);

const base = {
  organizationId: "org-1",
  userId: "user-1",
  rating: 5,
  displayName: "Mariam",
  businessName: "Boutique Mariam",
  status: "pending" as const,
  authorEmail: "mariam@example.com",
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-20T00:00:00.000Z",
};

describe("AdminReviewsPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    postMock.mockResolvedValue({});
    getMock.mockImplementation(async (path: string) => {
      if (path === "/platform/reviews/stats") {
        return { average: 4, count: 2, pending: 2, published: 0, rejected: 0, distribution: [0, 0, 1, 0, 1] };
      }
      return [
        { ...base, id: "r-1", comment: "Mon site en dix minutes.", publicConsent: true },
        { ...base, id: "r-2", comment: "Il manque la caisse.", publicConsent: false, rating: 3 },
      ];
    });
  });

  it("publishes a review whose author agreed, and cannot publish the other", async () => {
    renderWithProviders(<AdminReviewsPage />);
    expect(await screen.findByText("Mon site en dix minutes.")).toBeInTheDocument();
    expect(screen.getByText("Accepte l'affichage public")).toBeInTheDocument();
    expect(screen.getByText("Réservé à l'équipe")).toBeInTheDocument();

    const [publishConsented, publishPrivate] = screen.getAllByRole("button", {
      name: "Publier sur korvasuite.com",
    });
    expect(publishPrivate).toBeDisabled();
    fireEvent.click(publishConsented!);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/platform/reviews/r-1/moderate", { status: "published" }),
    );
  });

  it("declines a review with a message to its author", async () => {
    renderWithProviders(<AdminReviewsPage />);
    await screen.findByText("Il manque la caisse.");
    fireEvent.click(screen.getAllByRole("button", { name: "Ne pas publier" })[1]!);
    const message = screen.getByLabelText(/Message à l'auteur/);
    fireEvent.change(message, { target: { value: "Précisez svp." } });
    fireEvent.click(within(message.closest("form")!).getByRole("button", { name: "Ne pas publier" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/platform/reviews/r-2/moderate", {
        status: "rejected",
        reason: "Précisez svp.",
      }),
    );
  });
});
