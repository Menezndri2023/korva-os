import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConversationsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), getList: vi.fn() } };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);

const conversation = {
  id: "conv-1",
  contactId: "contact-1",
  channel: "email" as const,
  subject: "Bonjour",
  status: "open" as const,
};
const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

function mockConversationsPage(
  conversations: unknown[],
  pagination = { page: 1, limit: 20, total: conversations.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/conversations")) {
      return Promise.resolve({ data: conversations, pagination });
    }
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("ConversationsPage — pagination", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/contacts")) return Promise.resolve([contact]);
      throw new Error(`unexpected get ${path}`);
    });
    mockConversationsPage([]);
  });

  it("renders the empty state when there are no conversations", async () => {
    renderWithProviders(<ConversationsPage />);
    expect(await screen.findByText("Aucune conversation.")).toBeInTheDocument();
  });

  it("renders conversations from the paginated response", async () => {
    mockConversationsPage([conversation]);
    renderWithProviders(<ConversationsPage />);
    expect(await screen.findByText("Bonjour")).toBeInTheDocument();
  });

  it("fetches page 1 by default", async () => {
    renderWithProviders(<ConversationsPage />);
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/conversations?page=1"));
  });

  it("shows the page count from the response", async () => {
    mockConversationsPage([conversation], { page: 1, limit: 20, total: 45, totalPages: 3 });
    renderWithProviders(<ConversationsPage />);

    expect(await screen.findByText("Page 1 sur 3")).toBeInTheDocument();
  });

  it("clicking Suivant fetches the next page", async () => {
    mockConversationsPage([conversation], { page: 1, limit: 20, total: 45, totalPages: 3 });
    const user = userEvent.setup();
    renderWithProviders(<ConversationsPage />);

    await screen.findByText("Page 1 sur 3");
    mockConversationsPage([conversation], { page: 2, limit: 20, total: 45, totalPages: 3 });
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/conversations?page=2"));
    expect(await screen.findByText("Page 2 sur 3")).toBeInTheDocument();
  });
});
