import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InvoicesPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), getList: vi.fn() } };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);

const invoice = {
  id: "invoice-1",
  number: "INV-1",
  contactId: "contact-1",
  status: "issued" as const,
  total: 100,
  amountPaid: 0,
  currency: "EUR",
};
const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

function mockInvoicesPage(
  invoices: unknown[],
  pagination = { page: 1, limit: 20, total: invoices.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/invoices")) return Promise.resolve({ data: invoices, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("InvoicesPage — pagination", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/contacts")) return Promise.resolve([contact]);
      throw new Error(`unexpected get ${path}`);
    });
    mockInvoicesPage([]);
  });

  it("renders the empty state when there are no invoices", async () => {
    renderWithProviders(<InvoicesPage />);
    expect(await screen.findByText("Aucune facture.")).toBeInTheDocument();
  });

  it("renders invoices from the paginated response", async () => {
    mockInvoicesPage([invoice]);
    renderWithProviders(<InvoicesPage />);
    expect(await screen.findByText("INV-1")).toBeInTheDocument();
  });

  it("fetches page 1 by default", async () => {
    renderWithProviders(<InvoicesPage />);
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/invoices?page=1"));
  });

  it("shows the page count from the response", async () => {
    mockInvoicesPage([invoice], { page: 1, limit: 20, total: 45, totalPages: 3 });
    renderWithProviders(<InvoicesPage />);

    expect(await screen.findByText("Page 1 sur 3")).toBeInTheDocument();
  });

  it("clicking Suivant fetches the next page", async () => {
    mockInvoicesPage([invoice], { page: 1, limit: 20, total: 45, totalPages: 3 });
    const user = userEvent.setup();
    renderWithProviders(<InvoicesPage />);

    await screen.findByText("Page 1 sur 3");
    mockInvoicesPage([invoice], { page: 2, limit: 20, total: 45, totalPages: 3 });
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/invoices?page=2"));
    expect(await screen.findByText("Page 2 sur 3")).toBeInTheDocument();
  });
});
