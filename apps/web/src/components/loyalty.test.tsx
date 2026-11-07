import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";
import { ContactLoyaltyCard, LoyaltySettings } from "./loyalty";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

describe("ContactLoyaltyCard", () => {
  it("shows a full card's reward and marks it given", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      enabled: true, stamps: 10, stampsRequired: 10, reward: "1 coupe offerte", rewardsAvailable: 1, rewardsUsed: 0,
    });
    vi.mocked(apiClient.post).mockResolvedValue({
      enabled: true, stamps: 0, stampsRequired: 10, reward: "1 coupe offerte", rewardsAvailable: 0, rewardsUsed: 1,
    });
    renderWithProviders(<ContactLoyaltyCard contactId="c-1" />);
    expect(await screen.findByText("Récompense à donner : 1 coupe offerte")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Récompense donnée" }));
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith("/contacts/c-1/loyalty/redeem"));
    expect(await screen.findByText("0 / 10 tampons")).toBeInTheDocument();
  });

  it("shows nothing when the business has no loyalty card", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ enabled: false, stamps: 0, stampsRequired: 0, reward: "", rewardsAvailable: 0, rewardsUsed: 0 });
    const { container } = renderWithProviders(<ContactLoyaltyCard contactId="c-2" />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(container.textContent).not.toContain("Carte de fidélité");
  });
});

describe("LoyaltySettings", () => {
  it("saves how many stamps and which reward", async () => {
    vi.mocked(apiClient.patch).mockResolvedValue({});
    renderWithProviders(<LoyaltySettings organization={{ id: "o", name: "Salon" } as never} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Proposer une carte de fidélité" }));
    fireEvent.change(screen.getByLabelText("Tampons pour une récompense"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Récompense"), { target: { value: "1 brushing offert" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la carte de fidélité" }));
    await waitFor(() =>
      expect(apiClient.patch).toHaveBeenCalledWith("/organizations/me", {
        loyalty: { enabled: true, stampsRequired: 8, reward: "1 brushing offert" },
      }),
    );
  });
});
