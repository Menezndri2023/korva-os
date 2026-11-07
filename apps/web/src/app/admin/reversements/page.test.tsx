import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import AdminPayoutsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { adminApi } from "@/lib/platform-admin";

vi.mock("@/lib/platform-admin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-admin")>();
  return { ...actual, adminApi: { get: vi.fn(), post: vi.fn(), getList: vi.fn() } };
});

const getMock = vi.mocked(adminApi.get);
const postMock = vi.mocked(adminApi.post);

const payout = {
  id: "p-1",
  organizationId: "org-1",
  organizationName: "Boutique Awa",
  amount: 10000,
  currency: "XOF",
  status: "requested" as const,
  trigger: "manual" as const,
  destination: { provider: "wave" as const, account: "+225 07 07 07 07 07", holderName: "Awa Koné" },
  createdAt: "2026-10-30T00:00:00.000Z",
};

describe("AdminPayoutsPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    postMock.mockResolvedValue({});
    getMock.mockImplementation(async (path: string) =>
      path === "/platform/wallets/overview"
        ? { currency: "XOF", heldAvailable: 14325, heldPending: 0, commissionThisMonth: 225, payoutsToApprove: 1, payoutsProcessing: 0, approvalMode: "manual" }
        : [payout],
    );
  });

  it("approves a requested withdrawal", async () => {
    renderWithProviders(<AdminPayoutsPage />);
    expect(await screen.findByText("Boutique Awa")).toBeInTheDocument();
    expect(screen.getByText("Validation manuelle")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Valider et envoyer" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/platform/payouts/p-1/approve", {}));
  });

  it("refuses one with a reason", async () => {
    renderWithProviders(<AdminPayoutsPage />);
    await screen.findByText("Boutique Awa");
    fireEvent.click(screen.getByRole("button", { name: "Refuser" }));
    const reason = screen.getByLabelText(/Motif/);
    fireEvent.change(reason, { target: { value: "Numéro à vérifier" } });
    fireEvent.click(within(reason.closest("form")!).getByRole("button", { name: "Refuser le retrait" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/platform/payouts/p-1/reject", { reason: "Numéro à vérifier" }),
    );
  });

  it("records one paid by hand, with the operator's reference and fee", async () => {
    renderWithProviders(<AdminPayoutsPage />);
    await screen.findByText("Boutique Awa");
    fireEvent.click(screen.getByRole("button", { name: "Versé à la main" }));
    fireEvent.change(screen.getByLabelText("Référence de la transaction"), { target: { value: "WAVE-T123" } });
    fireEvent.change(screen.getByLabelText(/Frais payés/), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer comme versé" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/platform/payouts/p-1/mark-paid", { reference: "WAVE-T123", fee: 20 }),
    );
  });
});
