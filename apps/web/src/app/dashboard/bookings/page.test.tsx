import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() } };
});

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

const resource = { id: "res-1", name: "Salle 1" };
const offer = { id: "offer-1", name: "Séance" };
const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

function mockGetByPath(path: string) {
  if (path.startsWith("/bookings")) return Promise.resolve([]);
  if (path.startsWith("/resources")) return Promise.resolve([resource]);
  if (path.startsWith("/contacts")) return Promise.resolve([contact]);
  if (path.startsWith("/offers")) return Promise.resolve([offer]);
  if (path.startsWith("/availability")) return Promise.resolve({ windows: [], bookings: [] });
  throw new Error(`unexpected GET ${path}`);
}

describe("BookingsPage (migrated to @korva/ui Button/Input/Card in F2-B.9)", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
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
});
