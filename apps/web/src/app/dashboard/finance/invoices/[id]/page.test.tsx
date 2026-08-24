import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InvoiceDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "invoice-1" }),
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

const invoice = {
  id: "invoice-1",
  number: "INV-1",
  contactId: "contact-1",
  status: "issued" as const,
  items: [{ description: "Chaise", quantity: 2, unitPrice: 50, taxRate: 20 }],
  currency: "EUR",
  subtotal: 100,
  taxTotal: 20,
  total: 120,
  amountPaid: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function mockGetByPath(path: string) {
  if (path === "/invoices/invoice-1") return Promise.resolve(invoice);
  if (path.startsWith("/contacts")) return Promise.resolve([contact]);
  if (path.startsWith("/payments")) return Promise.resolve([]);
  throw new Error(`unexpected GET ${path}`);
}

describe("InvoiceDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
  });

  it("shows the invoice number, contact link, and line items", async () => {
    renderWithProviders(<InvoiceDetailPage />);

    expect(await screen.findByRole("heading", { name: "INV-1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/dashboard/crm/contact-1",
    );
    expect(screen.getByText("Chaise")).toBeInTheDocument();
  });

  it("shows the remaining balance (total - amountPaid)", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/invoices/invoice-1") return Promise.resolve({ ...invoice, amountPaid: 30 });
      return mockGetByPath(path);
    });
    renderWithProviders(<InvoiceDetailPage />);
    await screen.findByRole("heading", { name: "INV-1" });

    expect(screen.getByText("90,00 €")).toBeInTheDocument();
  });

  it("shows a message and a link back when the invoice does not exist", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/invoices/invoice-1") {
        return Promise.reject(new ApiError("INVOICE_NOT_FOUND", "Invoice not found"));
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<InvoiceDetailPage />);

    expect(await screen.findByText("Invoice not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour aux factures" })).toHaveAttribute(
      "href",
      "/dashboard/finance/invoices",
    );
  });

  it("lists existing payments", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/payments")) {
        return Promise.resolve([
          {
            id: "payment-1",
            invoiceId: "invoice-1",
            amount: 20,
            currency: "EUR",
            status: "completed",
            provider: "manual",
            method: "virement",
            createdAt: "2026-01-02T00:00:00.000Z",
          },
        ]);
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<InvoiceDetailPage />);

    expect(await screen.findByText(/virement/)).toBeInTheDocument();
  });

  it("shows the empty payments message when there are none", async () => {
    renderWithProviders(<InvoiceDetailPage />);
    expect(await screen.findByText("Aucun paiement enregistré.")).toBeInTheDocument();
  });

  it("records a payment for an issued invoice via POST /payments", async () => {
    postMock.mockResolvedValue({ id: "payment-1" });
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDetailPage />);
    await screen.findByRole("heading", { name: "INV-1" });

    await user.type(screen.getByPlaceholderText("Montant"), "50");
    await user.click(screen.getByRole("button", { name: "Enregistrer le paiement" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/payments", {
        invoiceId: "invoice-1",
        amount: 50,
        method: "",
      }),
    );
  });

  it("does not show the payment form for a draft invoice", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/invoices/invoice-1") return Promise.resolve({ ...invoice, status: "draft" as const });
      return mockGetByPath(path);
    });
    renderWithProviders(<InvoiceDetailPage />);
    await screen.findByRole("heading", { name: "INV-1" });

    expect(screen.queryByPlaceholderText("Montant")).not.toBeInTheDocument();
  });

  it("cancelling calls POST /invoices/:id/cancel", async () => {
    postMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<InvoiceDetailPage />);
    await screen.findByRole("heading", { name: "INV-1" });

    await user.click(screen.getByRole("button", { name: "Annuler" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/invoices/invoice-1/cancel"));
  });

  it("does not show Annuler for a paid invoice", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/invoices/invoice-1") return Promise.resolve({ ...invoice, status: "paid" as const });
      return mockGetByPath(path);
    });
    renderWithProviders(<InvoiceDetailPage />);
    await screen.findByRole("heading", { name: "INV-1" });

    expect(screen.queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
  });
});
