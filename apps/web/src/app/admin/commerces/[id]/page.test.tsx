import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import AdminShopPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";
import type { PlatformOrganization } from "@/lib/platform-admin";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "org-1" }) }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() } };
});

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

const shop: PlatformOrganization = {
  id: "org-1",
  name: "Boutique Abidjan",
  slug: "boutique-abidjan",
  businessModel: "retail",
  country: "CI",
  currency: "XOF",
  createdAt: "2026-10-01T00:00:00Z",
  enabledModules: ["website"],
  activationNudgeSentAt: null,
  counts: { offersOnline: 2, offersTotal: 3, orders: 5, bookings: 0 },
  members: [{ email: "owner@korva.test", name: "Awa K", status: "active" }],
  subscription: {
    planKey: "free",
    planName: "Gratuit",
    priceAmount: 0,
    priceCurrency: "XOF",
    status: "active",
    currentPeriodEnd: "2026-11-01T00:00:00Z",
    cancelAtPeriodEnd: false,
    trialPlanKey: null,
    trialEndsAt: null,
  },
  invoices: [
    {
      id: "inv-1",
      number: "KSUB-0001",
      amount: 9900,
      currency: "XOF",
      status: "open",
      periodStart: "2026-10-01T00:00:00Z",
      periodEnd: "2026-11-01T00:00:00Z",
      dueAt: "2026-10-08T00:00:00Z",
      paidAt: null,
    },
  ],
  recentActivity: [],
};

function renderPage() {
  return renderWithProviders(<AdminShopPage />);
}

describe("AdminShopPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockResolvedValue(shop);
    postMock.mockResolvedValue({});
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("shows the shop's subscription, counts and owner", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Boutique Abidjan" })).toBeInTheDocument();
    expect(screen.getByText("Gratuit")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /owner@korva\.test/ })).toHaveAttribute("href", "mailto:owner@korva.test");
  });

  it("assigns a plan paid outside the platform, after confirmation", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Boutique Abidjan" });
    fireEvent.change(screen.getByLabelText("Formule"), { target: { value: "pro" } });
    fireEvent.click(screen.getByRole("button", { name: "Attribuer" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/platform/organizations/org-1/plan", { planKey: "pro" }, { withOrganization: false }),
    );
  });

  it("records an invoice paid by Mobile Money", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Marquer payée" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/platform/organizations/org-1/invoices/inv-1/paid",
        undefined,
        { withOrganization: false },
      ),
    );
  });

  it("does nothing when the administrator cancels the confirmation", async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Attribuer" }));
    expect(postMock).not.toHaveBeenCalled();
  });

  it("extends the trial by the number of days typed", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Boutique Abidjan" });
    fireEvent.change(screen.getByLabelText("Nombre de jours"), { target: { value: "21" } });
    fireEvent.click(screen.getByRole("button", { name: "Prolonger de 21 jours" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/platform/organizations/org-1/trial", { days: 21 }, { withOrganization: false }),
    );
  });
});
