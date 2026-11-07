import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { WalletSummary } from "@korva/types";
import WalletPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() },
  };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);
const putMock = vi.mocked(apiClient.put);
const patchMock = vi.mocked(apiClient.patch);

const summary: WalletSummary = {
  currency: "XOF",
  available: 14325,
  pending: 5000,
  plan: "starter",
  commissionBasisPoints: 200,
  holdDays: 3,
  destination: null,
  pendingDestination: null,
  autoPayout: { enabled: false, frequency: "weekly", minimum: 5000 },
  openPayout: null,
  manualPayoutsLeftThisWeek: 1,
  autoPaySubscription: false,
};

function serve(wallet: WalletSummary) {
  getMock.mockImplementation(async (path: string) => {
    if (path === "/wallet") return wallet;
    if (path.startsWith("/wallet/entries"))
      return [{ id: "e-1", kind: "sale", amount: 15000, currency: "XOF", availableAt: "2026-10-30", createdAt: "2026-10-27" }];
    return [];
  });
}

describe("WalletPage", () => {
  beforeEach(() => {
    for (const mock of [getMock, postMock, putMock, patchMock]) mock.mockReset();
  });

  it("shows what one sale really brings in, every cost included", async () => {
    serve(summary);
    renderWithProviders(<WalletPage />);

    const wave = (await screen.findByText("Wave", { selector: "td" })).closest("tr")!;
    // 10 000 F by Wave on Starter: GeniusPay 2.5 % + 100 = 350, KORVA 2 % = 200,
    // withdrawal 1 % of the 9 450 credited = 95 → 9 355 received.
    expect(wave.textContent).toMatch(/350/);
    expect(wave.textContent).toMatch(/200/);
    expect(wave.textContent).toMatch(/95/);
    expect(wave.textContent).toMatch(/9\s?355/);

    fireEvent.change(screen.getByLabelText("Prix de la vente"), { target: { value: "1000" } });
    // 1 000 F by card: 160 + 20 + 8 → 812, a 18.8 % cost.
    const card = screen.getByText("Carte bancaire", { selector: "td" }).closest("tr")!;
    expect(card.textContent).toMatch(/812/);
    expect(card.textContent).toMatch(/18\.8 %/);
  });

  it("warns a shop in euros of GeniusPay's exchange rate, and counts it in the estimate", async () => {
    serve({ ...summary, currency: "EUR" });
    renderWithProviders(<WalletPage />);

    expect(await screen.findByText(/environ 610,70 F pour 1 €/)).toBeInTheDocument();
    // 10 € by Wave: 6 107 F charged; fee 252.68 F ≈ 0.39 €; exchange 10 − 9.31 = 0.69 €;
    // commission 0.20 €; withdrawal 1 % of 8.72 = 0.09 € → 8.63 €.
    const wave = screen.getByText("Wave", { selector: "td" }).closest("tr")!;
    expect(wave.textContent).toMatch(/0,69/);
    expect(wave.textContent).toMatch(/8,63/);
  });

  it("shows the balance, and asks for a number confirmed by code before any withdrawal", async () => {
    serve(summary);
    putMock.mockResolvedValue({ pending: true });
    renderWithProviders(<WalletPage />);

    expect(await screen.findByText("Vente payée en ligne")).toBeInTheDocument();
    expect(screen.getByText(/commission KORVA de 2 %/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retirer" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Numéro (format international)"), { target: { value: "+225 07 07 07 07 07" } });
    fireEvent.change(screen.getByLabelText("Nom du titulaire du compte"), { target: { value: "Awa Koné" } });
    fireEvent.click(screen.getByRole("button", { name: "Recevoir le code de confirmation" }));
    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith("/wallet/destination", {
        provider: "wave",
        account: "+225 07 07 07 07 07",
        holderName: "Awa Koné",
      }),
    );
  });

  it("confirms the number with the e-mailed code", async () => {
    serve({ ...summary, pendingDestination: { provider: "wave", account: "+225 07 07 07 07 07" } });
    postMock.mockResolvedValue({ confirmed: true });
    renderWithProviders(<WalletPage />);
    fireEvent.change(await screen.findByLabelText("Code reçu par e-mail"), { target: { value: "12a3456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmer le numéro" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/wallet/destination/confirm", { code: "123456" }));
  });

  it("withdraws, and says plainly when the week's request is used", async () => {
    serve({ ...summary, destination: { provider: "wave", account: "+225 07 07 07 07 07", holderName: "Awa Koné" } });
    postMock.mockRejectedValue(new ApiError("PAYOUT_WEEKLY_LIMIT", "limit"));
    renderWithProviders(<WalletPage />);
    fireEvent.change(await screen.findByLabelText(/Montant/), { target: { value: "10000" } });
    fireEvent.click(screen.getByRole("button", { name: "Retirer" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/wallet/payouts", { amount: 10000 }));
    expect(await screen.findByText(/déjà fait votre demande de retrait de la semaine/)).toBeInTheDocument();
  });

  it("switches on automatic withdrawals; daily is kept for Pro", async () => {
    serve(summary);
    patchMock.mockResolvedValue(summary);
    renderWithProviders(<WalletPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Verser automatiquement/ }));
    expect(screen.getByRole("option", { name: /Chaque jour \(à partir de Pro\)/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/wallet/auto-payout", { enabled: true, frequency: "weekly", minimum: 5000 }),
    );
  });

  it("lets the business pay its KORVA plan from the balance automatically", async () => {
    serve(summary);
    patchMock.mockResolvedValue({ ...summary, autoPaySubscription: true });
    renderWithProviders(<WalletPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /Régler automatiquement mes factures KORVA/ }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith("/wallet/subscription-autopay", { enabled: true }));
  });
});
