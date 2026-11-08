import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { Offer } from "@korva/types";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";
import { FeaturedOfferToggle } from "./featured-offer-toggle";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), patch: vi.fn() } };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const offer = { id: "o-1", name: "Pagne wax" } as Offer;

function onPlan(key: string) {
  vi.mocked(apiClient.get).mockResolvedValue({ plan: { key }, subscription: {} });
}

describe("FeaturedOfferToggle", () => {
  it("marks an offer as a favourite on Pro", async () => {
    onPlan("pro");
    vi.mocked(apiClient.patch).mockResolvedValue({ ...offer, featured: true });
    renderWithProviders(<FeaturedOfferToggle offer={offer} />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Mettre en coup de cœur" }));
    await waitFor(() => expect(apiClient.patch).toHaveBeenCalledWith("/offers/o-1", { featured: true }));
  });

  it("is locked below Pro, with the plan that unlocks it", async () => {
    onPlan("starter");
    renderWithProviders(<FeaturedOfferToggle offer={offer} />);
    expect(await screen.findByText("🔒 Formule Pro")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mettre en coup de cœur" })).toBeDisabled();
  });

  it("can always be removed, even after a downgrade", async () => {
    onPlan("free");
    renderWithProviders(<FeaturedOfferToggle offer={{ ...offer, featured: true }} />);
    await waitFor(() => expect(apiClient.get).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Coup de cœur sur votre site" })).toBeEnabled();
  });
});
