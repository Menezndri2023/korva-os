import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrderDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "order-1" }),
}));

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

const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

const order = {
  id: "order-1",
  number: "ORD-1",
  contactId: "contact-1",
  source: "manual",
  status: "pending" as const,
  items: [
    { description: "Chaise", quantity: 2, unitPrice: 50, taxRate: 20 },
    { description: "Coussin", quantity: 3, unitPrice: 10, taxRate: 0 },
  ],
  currency: "EUR",
  subtotal: 130,
  taxTotal: 20,
  total: 150,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function mockGetByPath(path: string) {
  if (path === "/orders/order-1") return Promise.resolve(order);
  if (path.startsWith("/contacts")) return Promise.resolve([contact]);
  if (path.startsWith("/offers")) return Promise.resolve([]);
  if (path.startsWith("/resources")) return Promise.resolve([]);
  if (path === "/orders/order-1/donation-receipt/availability") return Promise.resolve({ available: false });
  throw new Error(`unexpected GET ${path}`);
}

describe("OrderDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
  });

  it("shows the order number, contact link, and line items", async () => {
    renderWithProviders(<OrderDetailPage />);

    expect(await screen.findByRole("heading", { name: "ORD-1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/dashboard/crm/contact-1",
    );
    expect(screen.getByText("Chaise")).toBeInTheDocument();
  });

  it("shows the subtotal, tax and total from the order, not recomputed", async () => {
    renderWithProviders(<OrderDetailPage />);
    await screen.findByRole("heading", { name: "ORD-1" });

    expect(screen.getByText("130,00 €")).toBeInTheDocument();
    expect(screen.getByText("20,00 €")).toBeInTheDocument();
    expect(screen.getByText("150,00 €")).toBeInTheDocument();
  });

  it("shows a message and a link back when the order does not exist", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/orders/order-1") {
        return Promise.reject(new ApiError("ORDER_NOT_FOUND", "Order not found"));
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<OrderDetailPage />);

    expect(await screen.findByText("Order not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour aux commandes" })).toHaveAttribute(
      "href",
      "/dashboard/orders",
    );
  });

  it("confirming a pending order calls POST /orders/:id/confirm", async () => {
    postMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<OrderDetailPage />);
    await screen.findByRole("heading", { name: "ORD-1" });

    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/orders/order-1/confirm"));
  });

  it("only shows Facturer for a confirmed order without an invoice yet", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/orders/order-1") {
        return Promise.resolve({ ...order, status: "confirmed" as const });
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<OrderDetailPage />);

    expect(await screen.findByRole("button", { name: "Facturer" })).toBeInTheDocument();
  });

  it("does not show Facturer once the order already has an invoice", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/orders/order-1") {
        return Promise.resolve({ ...order, status: "confirmed" as const, invoiceId: "invoice-1" });
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<OrderDetailPage />);

    await screen.findByRole("heading", { name: "ORD-1" });
    expect(screen.queryByRole("button", { name: "Facturer" })).not.toBeInTheDocument();
    expect(screen.getByText("Générée")).toBeInTheDocument();
  });

  it("offers the donation receipt only once the API says the gift was received", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/orders/order-1") {
        return Promise.resolve({ ...order, status: "confirmed" as const, invoiceId: "invoice-1" });
      }
      if (path === "/orders/order-1/donation-receipt/availability") return Promise.resolve({ available: true });
      return mockGetByPath(path);
    });
    renderWithProviders(<OrderDetailPage />);

    expect(await screen.findByRole("button", { name: "Reçu de don (non fiscal)" })).toBeInTheDocument();
  });

  it("does not ask about a receipt for an order never invoiced", async () => {
    renderWithProviders(<OrderDetailPage />);
    await screen.findByRole("heading", { name: "ORD-1" });
    expect(getMock).not.toHaveBeenCalledWith("/orders/order-1/donation-receipt/availability");
    expect(screen.queryByRole("button", { name: "Reçu de don (non fiscal)" })).not.toBeInTheDocument();
  });

  it("shows the backend error message when an action fails", async () => {
    postMock.mockRejectedValue(new ApiError("ORDER_CONFLICT", "Cannot confirm this order"));
    const user = userEvent.setup();
    renderWithProviders(<OrderDetailPage />);
    await screen.findByRole("heading", { name: "ORD-1" });

    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    expect(await screen.findByText("Cannot confirm this order")).toBeInTheDocument();
  });

  describe("open tab — table link, item modifiers", () => {
    const openOrder = { ...order, status: "open" as const, resourceId: "res-1" };

    beforeEach(() => {
      getMock.mockImplementation((path: string) => {
        if (path === "/orders/order-1") return Promise.resolve(openOrder);
        if (path.startsWith("/contacts")) return Promise.resolve([contact]);
        if (path.startsWith("/offers")) {
          return Promise.resolve([
            { id: "offer-1", name: "Burger", pricing: { amount: 12, currency: "EUR" } },
          ]);
        }
        if (path.startsWith("/resources")) {
          return Promise.resolve([{ id: "res-1", name: "Table 5" }]);
        }
        throw new Error(`unexpected GET ${path}`);
      });
    });

    it("shows the order's table", async () => {
      renderWithProviders(<OrderDetailPage />);
      expect(await screen.findByText("Table 5")).toBeInTheDocument();
    });

    it("shows an item's modifiers next to its description", async () => {
      getMock.mockImplementation((path: string) => {
        if (path === "/orders/order-1") {
          return Promise.resolve({
            ...openOrder,
            items: [
              {
                description: "Burger",
                quantity: 1,
                unitPrice: 12,
                taxRate: 0,
                modifiers: [{ name: "Extra fromage", priceDelta: 1.5 }],
              },
            ],
          });
        }
        if (path.startsWith("/contacts")) return Promise.resolve([contact]);
        if (path.startsWith("/offers")) return Promise.resolve([]);
        if (path.startsWith("/resources")) {
          return Promise.resolve([{ id: "res-1", name: "Table 5" }]);
        }
        throw new Error(`unexpected GET ${path}`);
      });
      renderWithProviders(<OrderDetailPage />);
      expect(await screen.findByText(/Extra fromage/)).toBeInTheDocument();
    });

    it("submits a modifier alongside the new item via POST /orders/:id/items", async () => {
      postMock.mockResolvedValue(openOrder);
      const user = userEvent.setup();
      renderWithProviders(<OrderDetailPage />);
      await screen.findByRole("heading", { name: "ORD-1" });

      await user.selectOptions(screen.getByDisplayValue("Choisir un article"), "offer-1");
      await user.click(screen.getByRole("button", { name: "+ Ajouter un modificateur" }));
      await user.type(
        screen.getByPlaceholderText("Modificateur (ex: Sans oignon)"),
        "Extra fromage",
      );
      await user.type(screen.getByPlaceholderText("Supplément"), "1.5");
      await user.click(screen.getByRole("button", { name: "Ajouter l'article" }));

      await waitFor(() =>
        expect(postMock).toHaveBeenCalledWith("/orders/order-1/items", {
          offerId: "offer-1",
          quantity: 1,
          modifiers: [{ name: "Extra fromage", priceDelta: 1.5 }],
        }),
      );
    });

    it("splits selected items into a new order and shows a link to it", async () => {
      postMock.mockResolvedValue({
        original: { ...openOrder, items: [openOrder.items[0]] },
        splits: [
          {
            id: "order-2",
            number: "ORD-2",
            currency: "EUR",
            total: 30,
          },
        ],
      });
      const user = userEvent.setup();
      renderWithProviders(<OrderDetailPage />);
      await screen.findByRole("heading", { name: "ORD-1" });

      await user.click(screen.getByLabelText("Sélectionner Coussin"));
      await user.click(screen.getByRole("button", { name: "Créer une note séparée" }));

      await waitFor(() =>
        expect(postMock).toHaveBeenCalledWith("/orders/order-1/split", {
          groups: [{ items: [1] }],
        }),
      );
      expect(await screen.findByText(/Commande ORD-2/)).toBeInTheDocument();
    });
  });
});
