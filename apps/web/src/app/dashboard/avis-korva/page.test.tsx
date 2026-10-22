import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import KorvaReviewPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), patch: vi.fn() } };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const patchMock = vi.mocked(apiClient.patch);

describe("KorvaReviewPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
  });

  it("asks for a rating before sending, then sends rating, words and consent", async () => {
    getMock.mockResolvedValue(null);
    patchMock.mockResolvedValue({
      id: "r-1",
      rating: 4,
      comment: "Simple et rapide à prendre en main.",
      publicConsent: false,
      status: "pending",
      displayName: "Mariam",
      businessName: "Boutique Mariam",
    });
    renderWithProviders(<KorvaReviewPage />);

    const textarea = await screen.findByLabelText(/^Votre avis/);
    fireEvent.change(textarea, { target: { value: "Simple et rapide à prendre en main." } });
    fireEvent.click(screen.getByRole("button", { name: "Envoyer mon avis" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choisissez une note");
    expect(patchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "4 sur 5 — Très bien" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Envoyer mon avis" }));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/platform-reviews/me", {
        rating: 4,
        comment: "Simple et rapide à prendre en main.",
        publicConsent: false,
      }),
    );
    expect(await screen.findByText("En relecture")).toBeInTheDocument();
    expect(screen.getByText(/Réservé à l'équipe KORVA/)).toBeInTheDocument();
  });

  it("shows why the team did not publish it", async () => {
    getMock.mockResolvedValue({
      id: "r-1",
      rating: 2,
      comment: "Il manque des choses.",
      publicConsent: true,
      status: "rejected",
      rejectionReason: "Dites-nous lesquelles !",
      displayName: "Mariam",
      businessName: "Boutique Mariam",
    });
    renderWithProviders(<KorvaReviewPage />);
    expect(await screen.findByText("Non publié")).toBeInTheDocument();
    expect(screen.getByText(/Dites-nous lesquelles/)).toBeInTheDocument();
  });
});
