import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import KitchenDisplayPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

// The socket itself is exercised by the backend's own e2e test — this page test only needs to
// confirm the page renders/acts correctly on whatever `onChange` callback it's given, not that
// a real socket.io connection works.
const useKitchenSocketMock = vi.fn();
vi.mock("@/lib/use-kitchen-socket", () => ({
  useKitchenSocket: (onChange: () => void) => useKitchenSocketMock(onChange),
}));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

const newTicket = {
  ticket: { id: "ticket-1", organizationId: "org-1", orderId: "order-1", status: "new" as const },
  order: {
    id: "order-1",
    number: "CMD-1",
    items: [{ description: "Burger", quantity: 2 }],
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
};
const readyTicket = {
  ticket: {
    id: "ticket-2",
    organizationId: "org-1",
    orderId: "order-2",
    status: "ready" as const,
  },
  order: {
    id: "order-2",
    number: "CMD-2",
    items: [{ description: "Salade", quantity: 1 }],
    createdAt: new Date().toISOString(),
  },
};

describe("KitchenDisplayPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    useKitchenSocketMock.mockReset();
  });

  it("renders tickets grouped by status column", async () => {
    getMock.mockResolvedValue([newTicket, readyTicket]);
    renderWithProviders(<KitchenDisplayPage />);

    expect(await screen.findByText("Commande CMD-1")).toBeInTheDocument();
    expect(screen.getByText("2× Burger")).toBeInTheDocument();
    expect(screen.getByText("Commande CMD-2")).toBeInTheDocument();

    // One ticket landed in "new", the other in "ready" — the column counts prove the
    // ticket.status -> column filter grouped them correctly.
    expect(screen.getByText("Nouveau (1)")).toBeInTheDocument();
    expect(screen.getByText("En préparation (0)")).toBeInTheDocument();
    expect(screen.getByText("Prêt (1)")).toBeInTheDocument();
  });

  it("advances a ticket via POST /kitchen-tickets/:id/advance", async () => {
    getMock.mockResolvedValue([newTicket]);
    postMock.mockResolvedValue({ ...newTicket.ticket, status: "preparing" });
    const user = userEvent.setup();
    renderWithProviders(<KitchenDisplayPage />);
    await screen.findByText("Commande CMD-1");

    await user.click(screen.getByRole("button", { name: "Commencer" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/kitchen-tickets/ticket-1/advance"),
    );
  });

  it("subscribes to the kitchen socket for real-time updates", async () => {
    getMock.mockResolvedValue([]);
    renderWithProviders(<KitchenDisplayPage />);
    await screen.findByText("Nouveau (0)");

    expect(useKitchenSocketMock).toHaveBeenCalledWith(expect.any(Function));
  });
});
