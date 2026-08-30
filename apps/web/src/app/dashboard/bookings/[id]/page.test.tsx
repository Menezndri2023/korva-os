import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BookingDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "booking-1" }),
  useRouter: () => ({ push: pushMock }),
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
const resource = { id: "res-1", name: "Salle 1" };
const offer = { id: "offer-1", name: "Séance" };

const booking = {
  id: "booking-1",
  resourceId: "res-1",
  offerId: "offer-1",
  contactId: "contact-1",
  startAt: "2026-01-15T09:00:00.000Z",
  endAt: "2026-01-15T10:00:00.000Z",
  status: "pending" as const,
  pricing: { amount: 50, currency: "EUR" },
  paymentStatus: "unpaid" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function mockGetByPath(path: string) {
  if (path === "/bookings/booking-1") return Promise.resolve(booking);
  if (path.startsWith("/contacts")) return Promise.resolve([contact]);
  if (path.startsWith("/resources")) return Promise.resolve([resource]);
  if (path.startsWith("/offers")) return Promise.resolve([offer]);
  throw new Error(`unexpected GET ${path}`);
}

describe("BookingDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
  });

  it("shows the resource name, contact link, offer, and price", async () => {
    renderWithProviders(<BookingDetailPage />);

    expect(await screen.findByRole("heading", { name: "Salle 1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/dashboard/crm/contact-1",
    );
    expect(screen.getByText("Séance")).toBeInTheDocument();
    expect(screen.getByText("50,00 €")).toBeInTheDocument();
  });

  it("shows a message and a link back when the booking does not exist", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/bookings/booking-1") {
        return Promise.reject(new ApiError("BOOKING_NOT_FOUND", "Booking not found"));
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<BookingDetailPage />);

    expect(await screen.findByText("Booking not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour aux réservations" })).toHaveAttribute(
      "href",
      "/dashboard/bookings",
    );
  });

  it("cancelling a pending booking calls POST /bookings/:id/cancel", async () => {
    postMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<BookingDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    await user.click(screen.getByRole("button", { name: "Annuler la réservation" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/bookings/booking-1/cancel"));
  });

  it("does not show reschedule/cancel actions for a cancelled booking", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/bookings/booking-1") {
        return Promise.resolve({ ...booking, status: "cancelled" as const });
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<BookingDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    expect(screen.queryByRole("button", { name: "Déplacer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Annuler la réservation" })).not.toBeInTheDocument();
  });

  it("opens the reschedule form and submits POST /bookings/:id/reschedule with the new ISO range", async () => {
    postMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<BookingDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    await user.click(screen.getByRole("button", { name: "Déplacer" }));
    const [dateInput, startInput, endInput] = document.querySelectorAll("input[name]");
    await user.type(dateInput, "2026-02-01");
    await user.type(startInput, "14:00");
    await user.type(endInput, "15:00");
    await user.click(screen.getByRole("button", { name: "Confirmer le nouveau créneau" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/bookings/booking-1/reschedule", {
        startAt: new Date("2026-02-01T14:00:00.000Z").toISOString(),
        endAt: new Date("2026-02-01T15:00:00.000Z").toISOString(),
      }),
    );
  });

  it("shows the backend error message when an action fails", async () => {
    postMock.mockRejectedValue(
      new ApiError("BOOKING_ALREADY_CANCELLED", "This booking is already cancelled"),
    );
    const user = userEvent.setup();
    renderWithProviders(<BookingDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    await user.click(screen.getByRole("button", { name: "Annuler la réservation" }));

    expect(await screen.findByText("This booking is already cancelled")).toBeInTheDocument();
  });

  it("does not show 'Créer une commande' for a pending booking", async () => {
    renderWithProviders(<BookingDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    expect(screen.queryByRole("button", { name: "Créer une commande" })).not.toBeInTheDocument();
  });

  it("shows 'Créer une commande' for a confirmed booking, and navigates to the new order on success", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/bookings/booking-1") {
        return Promise.resolve({ ...booking, status: "confirmed" as const });
      }
      return mockGetByPath(path);
    });
    postMock.mockResolvedValue({ id: "order-99" });
    const user = userEvent.setup();
    renderWithProviders(<BookingDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    await user.click(screen.getByRole("button", { name: "Créer une commande" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/orders/from-booking", { bookingId: "booking-1" }),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard/orders/order-99"));
  });

  it("shows a friendly message (not a raw error) when an order already exists for the booking", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/bookings/booking-1") {
        return Promise.resolve({ ...booking, status: "confirmed" as const });
      }
      return mockGetByPath(path);
    });
    postMock.mockRejectedValue(
      new ApiError("ORDER_ALREADY_EXISTS", "An order already exists for this booking"),
    );
    const user = userEvent.setup();
    renderWithProviders(<BookingDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    await user.click(screen.getByRole("button", { name: "Créer une commande" }));

    expect(
      await screen.findByText("Une commande existe déjà pour cette réservation."),
    ).toBeInTheDocument();
    expect(screen.queryByText("An order already exists for this booking")).not.toBeInTheDocument();
  });

  it("marking a confirmed booking present calls POST /bookings/:id/complete with attended:true", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/bookings/booking-1") {
        return Promise.resolve({ ...booking, status: "confirmed" as const });
      }
      return mockGetByPath(path);
    });
    postMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<BookingDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    await user.click(screen.getByRole("button", { name: "Marquer présent(e)" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/bookings/booking-1/complete", {
        attended: true,
      }),
    );
  });

  it("marking a confirmed booking absent calls POST /bookings/:id/complete with attended:false", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/bookings/booking-1") {
        return Promise.resolve({ ...booking, status: "confirmed" as const });
      }
      return mockGetByPath(path);
    });
    postMock.mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderWithProviders(<BookingDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    await user.click(screen.getByRole("button", { name: "Marquer absent(e)" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/bookings/booking-1/complete", {
        attended: false,
      }),
    );
  });

  it("shows the Présence value once the booking has attended set", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/bookings/booking-1") {
        return Promise.resolve({
          ...booking,
          status: "completed" as const,
          attended: true,
        });
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<BookingDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    expect(screen.getByText("Présent(e)")).toBeInTheDocument();
  });

  it("also shows 'Créer une commande' for a completed booking", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/bookings/booking-1") {
        return Promise.resolve({ ...booking, status: "completed" as const });
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<BookingDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    expect(screen.getByRole("button", { name: "Créer une commande" })).toBeInTheDocument();
  });
});
