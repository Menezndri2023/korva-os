import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BookingPanel, CheckoutPanel } from "./commerce-panels";
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

  it("asks 'Avec qui ?' and shows each team member when every resource is a person", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/resources")) {
        return Promise.resolve([
          { id: "awa", name: "Awa", type: "person", description: "Coloriste", photo: "https://x/awa.png" },
          { id: "moussa", name: "Moussa", type: "person" },
        ]);
      }
      if (path.includes("/slots")) {
        return Promise.resolve({ date: "2026-07-06", durationMinutes: 45, slots: SLOTS });
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const user = userEvent.setup();
    renderPanel({ ...baseOffer, durationMinutes: 45 });

    const group = await screen.findByRole("radiogroup", { name: "Avec qui ?" });
    expect(group).toHaveTextContent("Coloriste");
    expect(screen.queryByLabelText("Emplacement")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Moussa/ }));
    await waitFor(() =>
      expect(slotsCalls().some((path) => path.includes("resourceId=moussa"))).toBe(true),
    );
  });

  it("books a stay with arrival and departure dates, priced by the API before confirming", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/resources")) {
        return Promise.resolve([{ id: "res-1", name: "Fauteuil 1", type: "room" }]);
      }
      if (path.includes("/stay-quote")) {
        return Promise.resolve({
          nights: 3,
          pricePerNight: 60,
          total: 180,
          currency: "EUR",
          minNights: 2,
          available: true,
          reason: null,
        });
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const user = userEvent.setup();
    renderPanel({ ...baseOffer, name: "Nuitée", bookingUnit: "night", minNights: 2 });

    await pickResource(user);
    expect(screen.queryByRole("group", { name: "Créneaux disponibles" })).not.toBeInTheDocument();
    const departure = screen.getByLabelText("Date de départ");
    await user.type(departure, "2099-01-04");
    expect(await screen.findByText("3 nuits · 180.00 EUR")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Adresse e-mail"), "voyageur@client.test");
    await user.click(screen.getByRole("button", { name: "Confirmer la réservation" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/public/salon/bookings",
        expect.objectContaining({ checkOut: "2099-01-04", resourceId: "res-1" }),
      ),
    );
    expect(getMock.mock.calls.some(([path]) => path.includes("/slots"))).toBe(false);
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

describe("CheckoutPanel — fulfillment", () => {
  const cart = [
    { offerId: "offer-1", name: "Garba", unitPrice: 2500, quantity: 1 },
  ] as unknown as Parameters<typeof CheckoutPanel>[0]["cart"];
  const reception = {
    fulfillmentModes: ["delivery", "pickup"] as ("delivery" | "pickup")[],
    deliveryZones: [
      { id: "cocody", name: "Cocody", fee: 1000, minimumOrder: 5000 },
      { id: "plateau", name: "Plateau", fee: 1500 },
    ],
    pickupInstructions: "Comptoir à gauche",
  };

  function renderCheckout(props: Partial<Parameters<typeof CheckoutPanel>[0]> = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <CheckoutPanel
          slug="maquis"
          cart={cart}
          currency="XOF"
          shippingFlatRate={2000}
          acceptedPaymentMethods={["cash"]}
          onClose={() => {}}
          onSuccess={() => {}}
          {...props}
        />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue({ id: "order-1", number: "CMD-1" });
  });

  it("keeps the old checkout when the shop configured no mode: flat rate, optional address", () => {
    renderCheckout();
    expect(screen.queryByRole("radiogroup", { name: "Mode de réception" })).not.toBeInTheDocument();
    expect(screen.getByText("Adresse de livraison (optionnel)")).toBeInTheDocument();
    expect(screen.getByText(/Livraison : 2000.00 XOF/)).toBeInTheDocument();
  });

  it("charges nothing and asks for no address for pickup, and sends the mode", async () => {
    const user = userEvent.setup();
    renderCheckout({ reception });

    await user.click(screen.getByRole("radio", { name: "Retrait sur place" }));
    expect(screen.queryByLabelText("Adresse")).not.toBeInTheDocument();
    expect(screen.getByText("Comptoir à gauche")).toBeInTheDocument();
    expect(screen.queryByText(/Livraison :/)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Adresse e-mail"), "kofi@client.ci");
    await user.click(screen.getByRole("button", { name: "Confirmer la commande" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/public/maquis/orders",
        expect.objectContaining({ fulfillmentMode: "pickup", shippingAddress: undefined }),
      ),
    );
  });

  it("shows the zone's fee and blocks a basket under the zone's minimum", async () => {
    const user = userEvent.setup();
    renderCheckout({ reception });

    // Delivery is the first mode, selected by default; no zone chosen yet.
    expect(screen.getByRole("button", { name: "Confirmer la commande" })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Zone de livraison"), "cocody");
    expect(screen.getByText(/Commande minimum pour Cocody/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer la commande" })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Zone de livraison"), "plateau");
    expect(screen.getByText(/Livraison : 1500.00 XOF/)).toBeInTheDocument();
    expect(screen.getByText(/Total : 4000.00 XOF/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer la commande" })).toBeEnabled();
  });

  it("sends a chosen time as the shop's wall-clock date and time, never as a browser instant", async () => {
    const user = userEvent.setup();
    renderCheckout({ reception: { ...reception, fulfillmentModes: ["pickup"] } });

    await user.click(screen.getByRole("radio", { name: "Choisir une heure" }));
    const date = screen.getByLabelText("Date souhaitée") as HTMLInputElement;
    await user.type(screen.getByLabelText("Heure souhaitée"), "12:30");
    await user.type(screen.getByLabelText("Adresse e-mail"), "kofi@client.ci");
    await user.click(screen.getByRole("button", { name: "Confirmer la commande" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/public/maquis/orders",
        expect.objectContaining({ requestedFor: { date: date.value, time: "12:30" } }),
      ),
    );
  });
});
