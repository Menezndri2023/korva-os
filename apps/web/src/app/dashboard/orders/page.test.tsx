import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrdersPage from "./page";
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
// A restaurant: its tables are booking resources, loaded only with the booking module on.
vi.mock("@/lib/use-active-organization", () => ({
  useActiveOrganization: () => ({ data: { id: "org-1", enabledModules: ["commerce", "booking"] } }),
}));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);

const order = {
  id: "order-1",
  number: "ORD-1",
  contactId: "contact-1",
  source: "manual",
  status: "pending" as const,
  total: 100,
  currency: "EUR",
};
const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

function mockOrdersPage(orders: unknown[], pagination = { page: 1, limit: 20, total: orders.length, totalPages: 1 }) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/orders")) return Promise.resolve({ data: orders, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("OrdersPage — pagination", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/contacts")) return Promise.resolve([contact]);
      if (path.startsWith("/resources")) return Promise.resolve([{ id: "res-1", name: "Table 5" }]);
      throw new Error(`unexpected get ${path}`);
    });
    mockOrdersPage([]);
  });

  it("renders the empty state when there are no orders", async () => {
    renderWithProviders(<OrdersPage />);
    expect(await screen.findByText("Aucune commande.")).toBeInTheDocument();
  });

  it("renders orders from the paginated response", async () => {
    mockOrdersPage([order]);
    renderWithProviders(<OrdersPage />);
    expect(await screen.findByText("ORD-1")).toBeInTheDocument();
  });

  it("fetches page 1 by default", async () => {
    renderWithProviders(<OrdersPage />);
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/orders?page=1"));
  });

  it("shows the page count from the response and disables Précédent on page 1", async () => {
    mockOrdersPage([order], { page: 1, limit: 20, total: 45, totalPages: 3 });
    renderWithProviders(<OrdersPage />);

    expect(await screen.findByText("Page 1 sur 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Précédent" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Suivant" })).not.toBeDisabled();
  });

  it("clicking Suivant fetches the next page", async () => {
    mockOrdersPage([order], { page: 1, limit: 20, total: 45, totalPages: 3 });
    const user = userEvent.setup();
    renderWithProviders(<OrdersPage />);

    await screen.findByText("Page 1 sur 3");
    mockOrdersPage([order], { page: 2, limit: 20, total: 45, totalPages: 3 });
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/orders?page=2"));
    expect(await screen.findByText("Page 2 sur 3")).toBeInTheDocument();
  });

  it("shows the order's table in its own column", async () => {
    mockOrdersPage([{ ...order, resourceId: "res-1" }]);
    renderWithProviders(<OrdersPage />);
    expect(await screen.findByText("Table 5")).toBeInTheDocument();
  });

  it("opens a tab with the selected table and calls POST /orders/open with resourceId", async () => {
    postMock.mockResolvedValue({ id: "order-2" });
    const user = userEvent.setup();
    renderWithProviders(<OrdersPage />);

    await user.click(screen.getByRole("button", { name: "Ouvrir une addition" }));
    await user.selectOptions(screen.getByDisplayValue("Choisir un client"), "contact-1");
    await user.selectOptions(screen.getByDisplayValue("Table (optionnel)"), "res-1");
    await user.click(screen.getByRole("button", { name: "Ouvrir" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/orders/open", {
        contactId: "contact-1",
        currency: "EUR",
        resourceId: "res-1",
      }),
    );
  });

  it("disables both pagination buttons while a page is loading", async () => {
    getListMock.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<OrdersPage />);

    expect(await screen.findByRole("button", { name: "Précédent" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Suivant" })).toBeDisabled();
  });
});
