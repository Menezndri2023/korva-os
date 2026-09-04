import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PurchaseOrdersPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: vi.fn(),
      getList: vi.fn(),
      post: vi.fn(),
    },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);

const supplier = { id: "supplier-1", organizationId: "org-1", name: "Acme Supplies" };
const offer = {
  id: "offer-1",
  type: "product" as const,
  name: "Widget",
  images: [],
  categories: [],
  pricing: { amount: 10, currency: "EUR" },
  variants: [],
  status: "active" as const,
  trackStock: true,
  customFields: {},
};

const purchaseOrder = {
  id: "po-1",
  organizationId: "org-1",
  supplierId: "supplier-1",
  status: "draft" as const,
  currency: "EUR",
  items: [{ offerId: "offer-1", name: "Widget", quantity: 5, unitCost: 2 }],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mockGetByPath(path: string) {
  if (path === "/suppliers") return Promise.resolve([supplier]);
  if (path === "/offers") return Promise.resolve([offer]);
  throw new Error(`unexpected GET ${path}`);
}

function mockPurchaseOrdersPage(
  purchaseOrders: unknown[],
  pagination = { page: 1, limit: 20, total: purchaseOrders.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/purchase-orders")) {
      return Promise.resolve({ data: purchaseOrders, pagination });
    }
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("PurchaseOrdersPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
    mockPurchaseOrdersPage([]);
  });

  it("shows an empty state when there are no purchase orders", async () => {
    renderWithProviders(<PurchaseOrdersPage />);
    expect(await screen.findByText("Aucune commande fournisseur.")).toBeInTheDocument();
  });

  it("renders a purchase order row with supplier name, items, and total", async () => {
    mockPurchaseOrdersPage([purchaseOrder]);
    renderWithProviders(<PurchaseOrdersPage />);

    expect(await screen.findByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    expect(screen.getByText("10,00 €")).toBeInTheDocument();
    expect(screen.getByText("Brouillon", { selector: "span" })).toBeInTheDocument();
  });

  it("creates a purchase order via the form", async () => {
    postMock.mockResolvedValue(purchaseOrder);
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />);

    await user.click(
      await screen.findByRole("button", { name: "Nouvelle commande fournisseur" }),
    );
    await user.selectOptions(screen.getByDisplayValue("Choisir un fournisseur"), "supplier-1");
    await user.selectOptions(screen.getByDisplayValue("Choisir un article"), "offer-1");
    const quantityInput = screen.getByPlaceholderText("Qté");
    await user.clear(quantityInput);
    await user.type(quantityInput, "5");
    const costInput = screen.getByPlaceholderText("Coût unitaire");
    await user.clear(costInput);
    await user.type(costInput, "2");
    await user.click(screen.getByRole("button", { name: "Créer la commande" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/purchase-orders", {
        supplierId: "supplier-1",
        items: [{ offerId: "offer-1", quantity: 5, unitCost: 2 }],
      }),
    );
  });

  it("marks a draft PO as ordered", async () => {
    mockPurchaseOrdersPage([purchaseOrder]);
    postMock.mockResolvedValue({ ...purchaseOrder, status: "ordered" });
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />);

    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "Marquer commandée" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/purchase-orders/po-1/mark-ordered"),
    );
  });

  it("receives an ordered PO and shows an error if the API rejects it", async () => {
    mockPurchaseOrdersPage([{ ...purchaseOrder, status: "ordered" }]);
    postMock.mockRejectedValue(
      new ApiError("STOCK_TRACKING_NOT_ENABLED", "Stock tracking is not enabled"),
    );
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />);

    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "Réceptionner" }));

    expect(await screen.findByText("Stock tracking is not enabled")).toBeInTheDocument();
  });

  it("cancels a draft PO", async () => {
    mockPurchaseOrdersPage([purchaseOrder]);
    postMock.mockResolvedValue({ ...purchaseOrder, status: "cancelled" });
    const user = userEvent.setup();
    renderWithProviders(<PurchaseOrdersPage />);

    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/purchase-orders/po-1/cancel"),
    );
  });
});
