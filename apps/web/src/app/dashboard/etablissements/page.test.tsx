import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import EstablishmentsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn() } };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));
const setActiveOrganization = vi.fn();
vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ bootstrapped: true, accessToken: "t", activeOrganizationId: "org-a", setActiveOrganization }),
}));
const getMock = vi.mocked(apiClient.get);

const overview = {
  periodDays: 30,
  establishments: [
    { organizationId: "org-a", name: "Salon Cocody", slug: "a", businessModel: "appointments", currency: "XOF", sales: 0, orders: 0, bookings: 42, collected: 210000, newContacts: 9 },
    { organizationId: "org-b", name: "Salon Plateau", slug: "b", businessModel: "appointments", currency: "XOF", sales: 0, orders: 0, bookings: 17, collected: 85000, newContacts: 3 },
  ],
};

describe("EstablishmentsPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    setActiveOrganization.mockReset();
  });

  it("lists every establishment side by side and opens another one", async () => {
    getMock.mockImplementation(async (path: string) =>
      path === "/subscriptions/me" ? { plan: { key: "business" }, subscription: {} } : overview,
    );
    renderWithProviders(<EstablishmentsPage />);
    await screen.findByText("Ouvert");
    const openPlateau = screen.getByRole("button", { name: "Ouvrir Salon Plateau" });
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Ouvert")).toBeInTheDocument();

    fireEvent.click(openPlateau);
    expect(setActiveOrganization).toHaveBeenCalledWith("org-b");
  });

  it("invites to Business below it, without loading the figures", async () => {
    getMock.mockImplementation(async (path: string) =>
      path === "/subscriptions/me" ? { plan: { key: "pro" }, subscription: {} } : overview,
    );
    renderWithProviders(<EstablishmentsPage />);
    expect(await screen.findByRole("link", { name: "Passer à Business" })).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalledWith("/network/overview");
  });
});
