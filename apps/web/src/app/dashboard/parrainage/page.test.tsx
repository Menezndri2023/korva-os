import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import ReferralPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn() } };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));
vi.mock("@/lib/use-active-organization", () => ({
  useActiveOrganization: () => ({ data: { name: "Salon Awa" } }),
}));

describe("ReferralPage", () => {
  it("gives the business its link, ready to send on WhatsApp, and what it has brought", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: "AB23CD", signedUp: 3, rewarded: 1 });
    renderWithProviders(<ReferralPage />);

    const link = `${window.location.origin}/register?ref=AB23CD`;
    expect(await screen.findByText(link)).toBeInTheDocument();
    const whatsapp = screen.getByRole("link", { name: "Envoyer sur WhatsApp" });
    expect(decodeURIComponent(whatsapp.getAttribute("href") ?? "")).toContain(link);
    expect(decodeURIComponent(whatsapp.getAttribute("href") ?? "")).toContain("Salon Awa");
    expect(screen.getByText("Inscrits avec votre lien").nextElementSibling).toHaveTextContent("3");
    expect(screen.getByText("Mois de Pro gagnés").nextElementSibling).toHaveTextContent("1");
  });
});
