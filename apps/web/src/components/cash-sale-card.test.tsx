import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { CashSaleCard } from "./cash-sale-card";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, post: vi.fn() } };
});

describe("CashSaleCard", () => {
  it("keeps a sale typed offline and sends it, with the same key, when the network is back", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });
    useAuthStore.setState({ activeOrganizationId: "org-1" });
    const post = vi.mocked(apiClient.post);
    post.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderWithProviders(<CashSaleCard currency="XOF" />);

    fireEvent.change(screen.getByLabelText("Montant"), { target: { value: "2 500" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la vente" }));
    expect(await screen.findByText(/Hors connexion : 1 vente\(s\) en attente/)).toBeInTheDocument();
    const firstKey = (post.mock.calls[0]![1] as { key: string }).key;

    post.mockResolvedValueOnce({ invoiceId: "i-1", replayed: false });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(screen.getByText(/Vente de .*2.?500.* enregistrée/)).toBeInTheDocument());
    expect(post).toHaveBeenLastCalledWith("/counter-payments/cash", expect.objectContaining({ amount: 2500, key: firstKey }));
    expect(JSON.parse(store.get("korva-till-queue:org-1")!)).toEqual([]);
    vi.unstubAllGlobals();
  });
});
