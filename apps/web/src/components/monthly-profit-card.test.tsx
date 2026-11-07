import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";
import { MonthlyProfitCard } from "./monthly-profit-card";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn() } };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

describe("MonthlyProfitCard", () => {
  it("shows what came in, refunds, expenses and the month's profit", async () => {
    vi.mocked(apiClient.get).mockResolvedValue({
      month: "2026-11",
      currency: "XOF",
      collected: 250000,
      refunded: 5000,
      expenses: 120000,
      profit: 125000,
      expensesByCategory: [{ category: "Loyer", amount: 80000 }],
    });
    renderWithProviders(<MonthlyProfitCard />);
    expect(await screen.findByText(/125\s000/)).toBeInTheDocument();
    expect(screen.getByText(/Plus grosses dépenses : Loyer/)).toBeInTheDocument();
    expect(vi.mocked(apiClient.get).mock.calls[0]![0]).toMatch(/^\/expenses\/profit\?month=\d{4}-\d{2}$/);
  });
});
