import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { CounterPayment } from "@korva/types";
import CounterPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() },
  };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

const pending: CounterPayment = {
  id: "p-1",
  invoiceId: "i-1",
  invoiceNumber: "FAC-0007",
  label: "Coupe homme",
  amount: 5000,
  currency: "XOF",
  status: "pending",
  checkoutUrl: "https://pay.genius.ci/c/MTX-1",
  createdAt: "2026-10-31T10:00:00.000Z",
};

describe("CounterPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it("shows the QR code for the amount typed, then turns to Payé once the customer has paid", async () => {
    let paid = false;
    getMock.mockImplementation(async (path: string) => {
      if (path === "/counter-payments") return paid ? [{ ...pending, status: "completed" }] : [];
      return { ...pending, status: paid ? "completed" : "pending" };
    });
    postMock.mockResolvedValue(pending);
    renderWithProviders(<CounterPage />);

    expect(await screen.findByText(/Aucune vente encaissée/)).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Afficher le QR code" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Montant à encaisser"), { target: { value: "5 000" } });
    fireEvent.change(screen.getByLabelText(/Pour quoi/), { target: { value: "Coupe homme" } });
    fireEvent.click(submit);

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/counter-payments", { amount: 5000, label: "Coupe homme" }),
    );
    expect(await screen.findByRole("img", { name: "QR code de paiement mobile money" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("img", { name: /QR code/ }).querySelector("svg")).not.toBeNull());
    expect(screen.getByText(/En attente du paiement/)).toBeInTheDocument();

    paid = true;
    expect(await screen.findByText("Payé", {}, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByText(/Facture FAC-0007 réglée/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Nouvelle vente" }));
    expect(screen.getByLabelText("Montant à encaisser")).toHaveValue("");
  }, 10_000);

  it("explains when mobile money is not available", async () => {
    getMock.mockResolvedValue([]);
    postMock.mockRejectedValue(new ApiError("ONLINE_PAYMENT_NOT_AVAILABLE", "nope"));
    renderWithProviders(<CounterPage />);

    fireEvent.change(await screen.findByLabelText("Montant à encaisser"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Afficher le QR code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("pas encore disponible");
  });
});
