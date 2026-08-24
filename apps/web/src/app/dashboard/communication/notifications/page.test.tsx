import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, getList: vi.fn() } };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getListMock = vi.mocked(apiClient.getList);

const notification = {
  id: "notif-1",
  title: "Nouvelle commande",
  read: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function mockNotificationsPage(
  notifications: unknown[],
  pagination = { page: 1, limit: 20, total: notifications.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/notifications")) {
      return Promise.resolve({ data: notifications, pagination });
    }
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("NotificationsPage — pagination", () => {
  beforeEach(() => {
    getListMock.mockReset();
    mockNotificationsPage([]);
  });

  it("renders the empty state when there are no notifications", async () => {
    renderWithProviders(<NotificationsPage />);
    expect(await screen.findByText("Aucune notification.")).toBeInTheDocument();
  });

  it("renders notifications from the paginated response", async () => {
    mockNotificationsPage([notification]);
    renderWithProviders(<NotificationsPage />);
    expect(await screen.findByText("Nouvelle commande")).toBeInTheDocument();
  });

  it("fetches page 1 by default", async () => {
    renderWithProviders(<NotificationsPage />);
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/notifications?page=1"));
  });

  it("shows the page count from the response", async () => {
    mockNotificationsPage([notification], { page: 1, limit: 20, total: 45, totalPages: 3 });
    renderWithProviders(<NotificationsPage />);

    expect(await screen.findByText("Page 1 sur 3")).toBeInTheDocument();
  });

  it("clicking Suivant fetches the next page", async () => {
    mockNotificationsPage([notification], { page: 1, limit: 20, total: 45, totalPages: 3 });
    const user = userEvent.setup();
    renderWithProviders(<NotificationsPage />);

    await screen.findByText("Page 1 sur 3");
    mockNotificationsPage([notification], { page: 2, limit: 20, total: 45, totalPages: 3 });
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/notifications?page=2"));
    expect(await screen.findByText("Page 2 sur 3")).toBeInTheDocument();
  });
});
