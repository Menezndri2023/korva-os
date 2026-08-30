import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WaitlistPage from "./page";
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

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);

const resource = { id: "res-1", name: "Salle 1" };
const offer = { id: "offer-1", name: "Séance" };
const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

function mockGetByPath(path: string) {
  if (path.startsWith("/resources")) return Promise.resolve([resource]);
  if (path.startsWith("/contacts")) return Promise.resolve([contact]);
  if (path.startsWith("/offers")) return Promise.resolve([offer]);
  throw new Error(`unexpected GET ${path}`);
}

function mockWaitlistPage(
  entries: unknown[],
  pagination = { page: 1, limit: 20, total: entries.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/waitlist")) return Promise.resolve({ data: entries, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("WaitlistPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
    mockWaitlistPage([]);
  });

  it("renders the toggle button and the empty state", async () => {
    renderWithProviders(<WaitlistPage />);
    expect(
      screen.getByRole("button", { name: "Ajouter à la liste d'attente" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Aucune entrée en liste d'attente.")).toBeInTheDocument();
  });

  it("renders an entry with the resource, contact and status", async () => {
    mockWaitlistPage([
      {
        id: "wl-1",
        resourceId: "res-1",
        offerId: "offer-1",
        contactId: "contact-1",
        startAt: "2026-01-15T09:00:00.000Z",
        endAt: "2026-01-15T10:00:00.000Z",
        status: "waiting",
      },
    ]);
    renderWithProviders(<WaitlistPage />);

    expect(await screen.findByText("Salle 1")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("En attente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retirer" })).toBeInTheDocument();
  });

  it("does not show a Retirer button for a notified or cancelled entry", async () => {
    mockWaitlistPage([
      {
        id: "wl-1",
        resourceId: "res-1",
        offerId: "offer-1",
        contactId: "contact-1",
        startAt: "2026-01-15T09:00:00.000Z",
        endAt: "2026-01-15T10:00:00.000Z",
        status: "notified",
      },
    ]);
    renderWithProviders(<WaitlistPage />);

    expect(await screen.findByText("Prévenu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retirer" })).not.toBeInTheDocument();
  });

  it("submits the create form and calls POST /waitlist with the typed values", async () => {
    postMock.mockResolvedValue({ id: "wl-1" });
    const user = userEvent.setup();
    renderWithProviders(<WaitlistPage />);

    await user.click(screen.getByRole("button", { name: "Ajouter à la liste d'attente" }));
    await user.selectOptions(screen.getByDisplayValue("Ressource"), "res-1");
    await user.selectOptions(screen.getByDisplayValue("Offre"), "offer-1");
    await user.selectOptions(screen.getByDisplayValue("Client"), "contact-1");

    const [dateInput, startInput, endInput] = document.querySelectorAll("input[name]");
    await user.type(dateInput, "2026-01-15");
    await user.type(startInput, "09:00");
    await user.type(endInput, "10:00");

    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/waitlist", {
        resourceId: "res-1",
        offerId: "offer-1",
        contactId: "contact-1",
        startAt: new Date("2026-01-15T09:00:00.000Z").toISOString(),
        endAt: new Date("2026-01-15T10:00:00.000Z").toISOString(),
      }),
    );
  });

  it("cancels an entry via POST /waitlist/:id/cancel", async () => {
    mockWaitlistPage([
      {
        id: "wl-1",
        resourceId: "res-1",
        offerId: "offer-1",
        contactId: "contact-1",
        startAt: "2026-01-15T09:00:00.000Z",
        endAt: "2026-01-15T10:00:00.000Z",
        status: "waiting",
      },
    ]);
    postMock.mockResolvedValue({ id: "wl-1" });
    const user = userEvent.setup();
    renderWithProviders(<WaitlistPage />);

    await user.click(await screen.findByRole("button", { name: "Retirer" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/waitlist/wl-1/cancel"));
  });

  it("fetches page 1 by default", async () => {
    renderWithProviders(<WaitlistPage />);
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/waitlist?page=1"));
  });
});
