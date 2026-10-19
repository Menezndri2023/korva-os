import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BookingPanel } from "./commerce-panels";
import { publicApiClient } from "@/lib/public-api-client";
import type { PublicOffer } from "@/lib/public-types";

vi.mock("@/lib/public-api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/public-api-client")>();
  return {
    ...actual,
    publicApiClient: { ...actual.publicApiClient, get: vi.fn(), post: vi.fn() },
  };
});

const getMock = vi.mocked(publicApiClient.get);
const postMock = vi.mocked(publicApiClient.post);

const baseOffer: PublicOffer = {
  id: "offer-1",
  type: "booking",
  name: "Coupe femme",
  images: [],
  categories: [],
  pricing: { amount: 35, currency: "EUR" },
  variants: [],
};

// What the API returns for a Paris salon in July: 14:00 local is 12:00 UTC.
const SLOTS = [
  { time: "14:00", startAt: "2026-07-06T12:00:00.000Z", endAt: "2026-07-06T12:45:00.000Z" },
  { time: "14:30", startAt: "2026-07-06T12:30:00.000Z", endAt: "2026-07-06T13:15:00.000Z" },
];

function renderPanel(offer: PublicOffer) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BookingPanel slug="salon" offer={offer} onClose={() => {}} onSuccess={() => {}} />
    </QueryClientProvider>,
  );
}

/** The resource list loads asynchronously: wait for its option before choosing it. */
async function pickResource(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("option", { name: "Fauteuil 1" });
  await user.selectOptions(screen.getByLabelText("Emplacement"), "res-1");
}

function slotsCalls(): string[] {
  return getMock.mock.calls.map(([path]) => path).filter((path) => path.includes("/slots"));
}

describe("BookingPanel", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/resources")) {
        return Promise.resolve([{ id: "res-1", name: "Fauteuil 1", type: "chair" }]);
      }
      if (path.includes("/slots")) {
        return Promise.resolve({ date: "2026-07-06", durationMinutes: 45, slots: SLOTS });
      }
      throw new Error(`unexpected GET ${path}`);
    });
    postMock.mockResolvedValue({ id: "booking-1", status: "confirmed" });
  });

  it("books the exact instants the API computed for the chosen slot — no timezone math in the browser", async () => {
    // The panel used to send `${date}T14:00:00.000Z` for "14:00", i.e. 16:00 in Paris.
    const user = userEvent.setup();
    renderPanel({ ...baseOffer, durationMinutes: 45 });

    await pickResource(user);
    await user.click(await screen.findByRole("button", { name: "14:00" }));
    await user.type(screen.getByLabelText("Adresse e-mail"), "awa@client.test");
    await user.click(screen.getByRole("button", { name: "Confirmer la réservation" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/public/salon/bookings",
        expect.objectContaining({
          resourceId: "res-1",
          offerId: "offer-1",
          startAt: "2026-07-06T12:00:00.000Z",
          endAt: "2026-07-06T12:45:00.000Z",
        }),
      ),
    );
  });

  it("shows a fixed-duration offer's length instead of asking for one", async () => {
    const user = userEvent.setup();
    renderPanel({ ...baseOffer, durationMinutes: 45 });

    expect(screen.getByText("Durée : 45 min")).toBeInTheDocument();
    expect(screen.queryByLabelText("Durée")).not.toBeInTheDocument();

    await pickResource(user);
    await waitFor(() => expect(slotsCalls()).toHaveLength(1));
    expect(slotsCalls()[0]).not.toContain("durationMinutes");
  });

  it("lets the visitor choose the length only when the offer has none, and asks the API for it", async () => {
    const user = userEvent.setup();
    renderPanel(baseOffer);

    await pickResource(user);
    await user.selectOptions(screen.getByLabelText("Durée"), "90");

    await waitFor(() =>
      expect(slotsCalls().some((path) => path.includes("durationMinutes=90"))).toBe(true),
    );
  });

  it("cannot be submitted before a slot is picked, and says so when a day has none", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/resources")) {
        return Promise.resolve([{ id: "res-1", name: "Fauteuil 1", type: "chair" }]);
      }
      return Promise.resolve({ date: "2026-07-06", durationMinutes: 45, slots: [] });
    });
    const user = userEvent.setup();
    renderPanel({ ...baseOffer, durationMinutes: 45 });

    await pickResource(user);

    expect(await screen.findByText("Aucun créneau disponible ce jour-là.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer la réservation" })).toBeDisabled();
  });
});
