import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), getList: vi.fn(), post: vi.fn() },
  };
});

// This page's queries are gated on auth bootstrap readiness (Bug #6) — these tests exercise
// the page's own behavior once that readiness is established, not the readiness gate itself
// (covered separately in use-auth-ready.test.ts).
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
  if (path.startsWith("/availability")) return Promise.resolve({ windows: [], bookings: [] });
  throw new Error(`unexpected GET ${path}`);
}

function mockBookingsPage(
  bookings: unknown[],
  pagination = { page: 1, limit: 20, total: bookings.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/bookings")) return Promise.resolve({ data: bookings, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("BookingsPage (migrated to @korva/ui Button/Input/Card in F2-B.9)", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
    mockBookingsPage([]);
  });

  it("renders the toggle button and the table wrapper", async () => {
    renderWithProviders(<BookingsPage />);
    expect(screen.getByRole("button", { name: "Nouvelle réservation" })).toBeInTheDocument();
    expect(await screen.findByText("Aucune réservation.")).toBeInTheDocument();
  });

  it("toggles the create form open and closed via the same button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BookingsPage />);

    expect(screen.queryByDisplayValue("Ressource")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nouvelle réservation" }));
    expect(screen.getByDisplayValue("Ressource")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByDisplayValue("Ressource")).not.toBeInTheDocument();
  });

  it("submits the create form and calls POST /bookings with exactly the selected/typed fields", async () => {
    postMock.mockResolvedValue({ id: "booking-1" });
    const user = userEvent.setup();
    renderWithProviders(<BookingsPage />);

    await user.click(screen.getByRole("button", { name: "Nouvelle réservation" }));
    await user.selectOptions(screen.getByDisplayValue("Ressource"), "res-1");
    await user.selectOptions(screen.getByDisplayValue("Offre"), "offer-1");
    await user.selectOptions(screen.getByDisplayValue("Client"), "contact-1");

    const [dateInput, startInput, endInput] = document.querySelectorAll("input[name]");
    await user.type(dateInput, "2026-01-15");
    await user.type(startInput, "09:00");
    await user.type(endInput, "10:00");

    await user.click(screen.getByRole("button", { name: "Créer la réservation" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/bookings", {
        resourceId: "res-1",
        offerId: "offer-1",
        contactId: "contact-1",
        startAt: new Date("2026-01-15T09:00:00.000Z").toISOString(),
        endAt: new Date("2026-01-15T10:00:00.000Z").toISOString(),
      }),
    );
  });

  it("shows a loading state on the submit button while the request is pending", async () => {
    postMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<BookingsPage />);

    await user.click(screen.getByRole("button", { name: "Nouvelle réservation" }));
    await user.selectOptions(screen.getByDisplayValue("Ressource"), "res-1");
    await user.selectOptions(screen.getByDisplayValue("Offre"), "offer-1");
    await user.selectOptions(screen.getByDisplayValue("Client"), "contact-1");
    const [dateInput, startInput, endInput] = document.querySelectorAll("input[name]");
    await user.type(dateInput, "2026-01-15");
    await user.type(startInput, "09:00");
    await user.type(endInput, "10:00");
    await user.click(screen.getByRole("button", { name: "Créer la réservation" }));

    expect(await screen.findByRole("button", { name: "Création..." })).toBeDisabled();
  });

  it("fetches page 1 by default and shows the page count from the response", async () => {
    mockBookingsPage([], { page: 1, limit: 20, total: 45, totalPages: 3 });
    renderWithProviders(<BookingsPage />);

    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/bookings?page=1"));
    expect(await screen.findByText("Page 1 sur 3")).toBeInTheDocument();
  });

  it("clicking Suivant fetches the next page", async () => {
    mockBookingsPage([], { page: 1, limit: 20, total: 45, totalPages: 3 });
    const user = userEvent.setup();
    renderWithProviders(<BookingsPage />);

    await screen.findByText("Page 1 sur 3");
    mockBookingsPage([], { page: 2, limit: 20, total: 45, totalPages: 3 });
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/bookings?page=2"));
    expect(await screen.findByText("Page 2 sur 3")).toBeInTheDocument();
  });
});
