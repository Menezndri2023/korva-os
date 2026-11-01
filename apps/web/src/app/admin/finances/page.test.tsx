import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import AdminFinancePage from "./page";
import { renderWithProviders } from "@/test/render";
import { adminApi, type PlatformFinance } from "@/lib/platform-admin";

vi.mock("@/lib/platform-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-admin")>();
  return { ...actual, adminApi: { get: vi.fn(), post: vi.fn(), getList: vi.fn() } };
});

const getMock = vi.mocked(adminApi.get);
const postMock = vi.mocked(adminApi.post);

const finance: PlatformFinance = {
  periodDays: 30,
  plansPaid: [{ currency: "XOF", total: 9900, count: 1 }],
  onlineSales: { currency: "XOF", total: 15000, count: 1, commissions: 225, providerFees: 450 },
  payoutsPaid: { total: 0, fees: 0, count: 0 },
  held: { currency: "XOF", available: 14325, pending: 0 },
  openInvoices: [
    {
      id: "inv-2",
      organizationId: "org-1",
      organizationName: "Salon Awa",
      number: "ABO-0142",
      amount: 9900,
      currency: "XOF",
      dueAt: "2026-10-30T00:00:00Z",
      overdue: true,
    },
  ],
};

describe("AdminFinancePage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockResolvedValue(finance);
    postMock.mockResolvedValue({});
  });

  it("shows KORVA's money and the invoices to chase, and switches period", async () => {
    renderWithProviders(<AdminFinancePage />);
    expect(await screen.findByText("Commissions KORVA")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Salon Awa" })).toHaveAttribute("href", "/admin/entreprises/org-1");
    expect(screen.getByText("En retard")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "12 mois" }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/platform/finance?days=365"));
  });

  it("records a plan invoice paid outside the platform after confirming", async () => {
    renderWithProviders(<AdminFinancePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Marquer payée" }));
    expect(postMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirmer le paiement reçu" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/platform/organizations/org-1/invoices/inv-2/paid"),
    );
  });
});
