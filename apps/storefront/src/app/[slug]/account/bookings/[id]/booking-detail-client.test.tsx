import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { publicApiClient } from "@/lib/public-api-client";
import type { CustomerBookingDetail } from "@/lib/public-types";
import BookingDetailClient from "./booking-detail-client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/use-customer-auth", () => ({
  useCustomerAuth: () => ({
    hydrated: true,
    isAuthenticated: true,
    authFetch: <T,>(call: (token: string) => Promise<T>) => call("token"),
  }),
}));
vi.mock("../../account-shell", () => ({
  AccountShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/public-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-api-client")>();
  return {
    ...actual,
    publicApiClient: { ...actual.publicApiClient, get: vi.fn(), post: vi.fn() },
  };
});

const getMock = vi.mocked(publicApiClient.get);
const postMock = vi.mocked(publicApiClient.post);

const booking: CustomerBookingDetail = {
  id: "bk-1",
  status: "confirmed",
  startAt: "2030-03-04T09:00:00.000Z",
  endAt: "2030-03-04T10:00:00.000Z",
  pricing: { amount: 10000, currency: "XOF" },
  offerName: "Tresses africaines",
  cancellationHours: 24,
  cancellableUntil: "2030-03-03T09:00:00.000Z",
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BookingDetailClient slug="salon" bookingId="bk-1" />
    </QueryClientProvider>,
  );
}

describe("BookingDetailClient — free cancellation", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
  });

  it("cancels only after the customer confirms", async () => {
    getMock.mockResolvedValue(booking);
    postMock.mockResolvedValue({ id: "bk-1", status: "cancelled" });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Annuler ma réservation" }));
    expect(postMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Oui, annuler" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/public/salon/account/bookings/bk-1/cancel", {}, "token"),
    );
  });

  it("explains the period is over instead of offering a button", async () => {
    getMock.mockResolvedValue({ ...booking, cancellableUntil: undefined });
    renderPage();

    expect(await screen.findByText(/délai d'annulation gratuite \(24 h avant\) est passé/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Annuler ma réservation" })).not.toBeInTheDocument();
  });
});
