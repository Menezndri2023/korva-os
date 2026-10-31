import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { KorvaPlanInvoices } from "./korva-plan-invoices";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() } };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

const invoice = {
  id: "inv-1",
  number: "ABO-0003",
  status: "open",
  amount: 24900,
  currency: "XOF",
  periodStart: "2026-11-01T00:00:00.000Z",
  periodEnd: "2026-12-01T00:00:00.000Z",
  dueAt: "2026-11-08T00:00:00.000Z",
};

function serve(available: number) {
  getMock.mockImplementation(async (path: string) =>
    path === "/wallet" ? { currency: "XOF", available } : [invoice],
  );
}

describe("KorvaPlanInvoices", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it("pays an open invoice from the balance when it covers it", async () => {
    serve(30000);
    postMock.mockResolvedValue({ invoiceNumber: "ABO-0003", status: "paid" });
    renderWithProviders(<KorvaPlanInvoices />);
    fireEvent.click(await screen.findByRole("button", { name: /Payer avec mon Solde/ }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/subscriptions/invoices/inv-1/pay-from-wallet"));
  });

  it("offers mobile money or card when the balance is too low", async () => {
    serve(1000);
    postMock.mockResolvedValue({ checkoutUrl: "https://pay.genius.ci/c/1" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, search: "" });
    renderWithProviders(<KorvaPlanInvoices />);
    expect(await screen.findByRole("button", { name: /Payer avec mon Solde/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Payer par mobile money ou carte" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://pay.genius.ci/c/1"));
    vi.unstubAllGlobals();
  });
});
