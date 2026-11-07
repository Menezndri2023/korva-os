import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LoyaltyCard } from "./loyalty-card";

describe("LoyaltyCard", () => {
  it("shows the stamps and how many are left for the reward", async () => {
    const authFetch = vi.fn().mockResolvedValue({
      enabled: true, stamps: 7, stampsRequired: 10, reward: "1 coupe offerte", rewardsAvailable: 0, rewardsUsed: 0,
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LoyaltyCard slug="salon" authFetch={authFetch} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Encore 3 pour : 1 coupe offerte.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "7 tampons sur 10" })).toBeInTheDocument();
  });
});
