import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ReturnsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), getList: vi.fn(), post: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);

const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

const returnRequest = {
  id: "return-1",
  organizationId: "org-1",
  orderId: "order-1",
  contactId: "contact-1",
  items: [
    {
      lineItemIndex: 0,
      description: "T-shirt",
      quantity: 1,
      unitPrice: 20,
    },
  ],
  reason: "Mauvaise taille",
  status: "pending" as const,
  refundAmount: 20,
  currency: "EUR",
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

function mockReturnsPage(
  returns: unknown[],
  pagination = { page: 1, limit: 20, total: returns.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/returns")) return Promise.resolve({ data: returns, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("ReturnsPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path === "/contacts") return Promise.resolve([contact]);
      throw new Error(`unexpected GET ${path}`);
    });
    mockReturnsPage([]);
  });

  it("renders the empty state", async () => {
    renderWithProviders(<ReturnsPage />);
    expect(await screen.findByText("Aucune demande de retour.")).toBeInTheDocument();
  });

  it("renders a pending return request with the resolved contact name", async () => {
    mockReturnsPage([returnRequest]);
    renderWithProviders(<ReturnsPage />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Mauvaise taille")).toBeInTheDocument();
    expect(screen.getByText("20 EUR")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("En attente")).toBeInTheDocument();
  });

  it("defaults to filtering by pending status", async () => {
    renderWithProviders(<ReturnsPage />);
    await waitFor(() =>
      expect(getListMock).toHaveBeenCalledWith("/returns?page=1&status=pending"),
    );
  });

  it("approves a pending return request", async () => {
    mockReturnsPage([returnRequest]);
    postMock.mockResolvedValue({ ...returnRequest, status: "approved", refundId: "refund-1" });
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Approuver (rembourser)" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/returns/return-1/approve"),
    );
  });

  it("requires a confirmation click before rejecting", async () => {
    mockReturnsPage([returnRequest]);
    postMock.mockResolvedValue({ ...returnRequest, status: "rejected" });
    const user = userEvent.setup();
    renderWithProviders(<ReturnsPage />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Refuser" }));
    expect(screen.getByRole("button", { name: "Confirmer ?" })).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/returns/return-1/reject", {}),
    );
  });

  it("does not show approve/reject actions for an already-reviewed request", async () => {
    mockReturnsPage([{ ...returnRequest, status: "approved" }]);
    renderWithProviders(<ReturnsPage />);
    await screen.findByText("Ada Lovelace");

    expect(screen.queryByRole("button", { name: "Approuver (rembourser)" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refuser" })).not.toBeInTheDocument();
  });
});
