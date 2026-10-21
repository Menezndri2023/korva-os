import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import AdminShopPage from "./page";
import { renderWithProviders } from "@/test/render";
import { adminApi } from "@/lib/platform-admin";
import type { PlatformOrganization } from "@/lib/platform-admin";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "org-1" }) }));

vi.mock("@/lib/platform-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-admin")>();
  return { ...actual, adminApi: { get: vi.fn(), post: vi.fn(), getList: vi.fn() } };
});

const getMock = vi.mocked(adminApi.get);
const postMock = vi.mocked(adminApi.post);

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
  counts: { offersOnline: 2, offersTotal: 3, orders: 5, bookings: 0, quotes: 1, leads: 0, contacts: 12, invoices: 2 },
  suspendedAt: null,
  suspensionReason: null,
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
      expect(postMock).toHaveBeenCalledWith("/platform/organizations/org-1/plan", { planKey: "pro" }),
    );
  });

  it("records an invoice paid by Mobile Money", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Marquer payée" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/platform/organizations/org-1/invoices/inv-1/paid"),
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
      expect(postMock).toHaveBeenCalledWith("/platform/organizations/org-1/trial", { days: 21 }),
    );
  });

  it("suspends the business with a reason, only once one is typed", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Boutique Abidjan" });
    const suspend = screen.getByRole("button", { name: "Suspendre" });
    expect(suspend).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Motif de la suspension"), { target: { value: "Impayé" } });
    fireEvent.click(suspend);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/platform/organizations/org-1/suspend",
        { reason: "Impayé" },
      ),
    );
  });

  it("offers reactivation for a suspended business", async () => {
    getMock.mockResolvedValue({ ...shop, suspendedAt: "2026-10-20T00:00:00Z", suspensionReason: "Impayé" });
    renderPage();
    expect(await screen.findByText(/Entreprise suspendue depuis le/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Réactiver" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/platform/organizations/org-1/reactivate"),
    );
  });
});
