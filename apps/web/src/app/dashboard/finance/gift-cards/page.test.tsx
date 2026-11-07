import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";
import GiftCardsPage from "./page";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() } };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));
vi.mock("@/lib/use-active-organization", () => ({ useActiveOrganization: () => ({ data: { currency: "XOF" } }) }));

describe("GiftCardsPage", () => {
  it("issues a card, shows its code, and lists what is left on each", async () => {
    vi.mocked(apiClient.get).mockResolvedValue([
      { id: "g-1", code: "KDO-AAAA-BBBB", initialAmount: 10000, balance: 4000, currency: "XOF", status: "active", expiresAt: null, uses: [], createdAt: "2026-11-01T10:00:00Z" },
    ]);
    vi.mocked(apiClient.post).mockResolvedValue({
      id: "g-2", code: "KDO-CCCC-DDDD", initialAmount: 5000, balance: 5000, currency: "XOF", status: "active", recipientEmail: "fatou@example.com", expiresAt: null, uses: [], createdAt: "2026-11-07T10:00:00Z",
    });
    renderWithProviders(<GiftCardsPage />);
    expect(await screen.findByText("KDO-AAAA-BBBB")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Montant (XOF)"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/E-mail du bénéficiaire/), { target: { value: "fatou@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer la carte cadeau" }));
    await waitFor(() =>
      expect(apiClient.post).toHaveBeenCalledWith("/gift-cards", expect.objectContaining({ amount: 5000, recipientEmail: "fatou@example.com", sendEmail: true })),
    );
    expect(await screen.findByText("KDO-CCCC-DDDD")).toBeInTheDocument();
  });
});
