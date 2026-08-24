import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import QuotesPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), getList: vi.fn() } };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);

const quote = {
  id: "quote-1",
  number: "QUO-1",
  contactId: "contact-1",
  status: "draft" as const,
  total: 100,
  currency: "EUR",
};
const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

function mockQuotesPage(
  quotes: unknown[],
  pagination = { page: 1, limit: 20, total: quotes.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/quotes")) return Promise.resolve({ data: quotes, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("QuotesPage — pagination", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/contacts")) return Promise.resolve([contact]);
      throw new Error(`unexpected get ${path}`);
    });
    mockQuotesPage([]);
  });

  it("renders the empty state when there are no quotes", async () => {
    renderWithProviders(<QuotesPage />);
    expect(await screen.findByText("Aucun devis.")).toBeInTheDocument();
  });

  it("renders quotes from the paginated response", async () => {
    mockQuotesPage([quote]);
    renderWithProviders(<QuotesPage />);
    expect(await screen.findByText("QUO-1")).toBeInTheDocument();
  });

  it("fetches page 1 by default", async () => {
    renderWithProviders(<QuotesPage />);
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/quotes?page=1"));
  });

  it("shows the page count from the response", async () => {
    mockQuotesPage([quote], { page: 1, limit: 20, total: 45, totalPages: 3 });
    renderWithProviders(<QuotesPage />);

    expect(await screen.findByText("Page 1 sur 3")).toBeInTheDocument();
  });

  it("clicking Suivant fetches the next page", async () => {
    mockQuotesPage([quote], { page: 1, limit: 20, total: 45, totalPages: 3 });
    const user = userEvent.setup();
    renderWithProviders(<QuotesPage />);

    await screen.findByText("Page 1 sur 3");
    mockQuotesPage([quote], { page: 2, limit: 20, total: 45, totalPages: 3 });
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/quotes?page=2"));
    expect(await screen.findByText("Page 2 sur 3")).toBeInTheDocument();
  });
});
