import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuoteDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "quote-1" }),
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

const quote = {
  id: "quote-1",
  number: "QUO-1",
  contactId: "contact-1",
  status: "draft" as const,
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
  if (path === "/quotes/quote-1") return Promise.resolve(quote);
  if (path.startsWith("/contacts")) return Promise.resolve([contact]);
  throw new Error(`unexpected GET ${path}`);
}

describe("QuoteDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
  });

  it("shows the quote number, contact link, and line items", async () => {
    renderWithProviders(<QuoteDetailPage />);

    expect(await screen.findByRole("heading", { name: "QUO-1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/dashboard/crm/contact-1",
    );
    expect(screen.getByText("Chaise")).toBeInTheDocument();
    expect(screen.getByText("150,00 €")).toBeInTheDocument();
  });

  it("shows a message and a link back when the quote does not exist", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/quotes/quote-1") {
        return Promise.reject(new ApiError("QUOTE_NOT_FOUND", "Quote not found"));
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<QuoteDetailPage />);

    expect(await screen.findByText("Quote not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour aux devis" })).toHaveAttribute(
      "href",
      "/dashboard/finance",
    );
  });

  it("a draft quote only shows Envoyer", async () => {
    renderWithProviders(<QuoteDetailPage />);
    await screen.findByRole("heading", { name: "QUO-1" });

    expect(screen.getByRole("button", { name: "Envoyer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accepter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refuser" })).not.toBeInTheDocument();
  });

  it("a sent quote shows Accepter and Refuser", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/quotes/quote-1") return Promise.resolve({ ...quote, status: "sent" as const });
      return mockGetByPath(path);
    });
    renderWithProviders(<QuoteDetailPage />);

    expect(await screen.findByRole("button", { name: "Accepter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refuser" })).toBeInTheDocument();
  });

  it("rejecting calls POST /quotes/:id/reject", async () => {
    postMock.mockResolvedValue(undefined);
    getMock.mockImplementation((path: string) => {
      if (path === "/quotes/quote-1") return Promise.resolve({ ...quote, status: "sent" as const });
      return mockGetByPath(path);
    });
    const user = userEvent.setup();
    renderWithProviders(<QuoteDetailPage />);
    await screen.findByRole("button", { name: "Refuser" });

    await user.click(screen.getByRole("button", { name: "Refuser" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/quotes/quote-1/reject"));
  });

  it("an accepted quote shows Convertir en facture", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/quotes/quote-1") {
        return Promise.resolve({ ...quote, status: "accepted" as const });
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<QuoteDetailPage />);

    expect(await screen.findByRole("button", { name: "Convertir en facture" })).toBeInTheDocument();
  });

  it("shows the backend error message when an action fails", async () => {
    postMock.mockRejectedValue(new ApiError("QUOTE_CONFLICT", "Cannot send this quote"));
    const user = userEvent.setup();
    renderWithProviders(<QuoteDetailPage />);
    await screen.findByRole("heading", { name: "QUO-1" });

    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(await screen.findByText("Cannot send this quote")).toBeInTheDocument();
  });
});
