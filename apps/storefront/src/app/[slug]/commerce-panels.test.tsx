import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BookingPanel, CheckoutPanel, RequestPanel } from "./commerce-panels";
import { publicApiClient } from "@/lib/public-api-client";
import { useCart } from "@/lib/use-cart";
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

/** The resource list loads asynchronously: wait for its option before choosing it. The first test
 *  of the file also pays for the panel's lazy chunk, which took over the default 1 s whenever the
 *  whole monorepo's suites ran in parallel. */
async function pickResource(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("option", { name: "Fauteuil 1" }, { timeout: 5_000 });
  await user.selectOptions(screen.getByLabelText(/^(Emplacement|Logement)$/), "res-1");
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
        return Promise.resolve([
          { id: "res-1", name: "Fauteuil 1", type: "chair" },
          { id: "res-2", name: "Fauteuil 2", type: "chair" },
        ]);
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
        return Promise.resolve([
          { id: "res-1", name: "Fauteuil 1", type: "room" },
          { id: "res-2", name: "Fauteuil 2", type: "room" },
        ]);
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

  it("asks a restaurant's customer for a party size, not a table, and lets the API choose the table", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/resources")) {
        return Promise.resolve([
          { id: "t1", name: "Table 1", type: "room", seats: 2 },
          { id: "t2", name: "Table 2", type: "room", seats: 6 },
        ]);
      }
      if (path.includes("/table-slots")) {
        return Promise.resolve({ date: "2026-07-06", durationMinutes: 90, slots: SLOTS });
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const user = userEvent.setup();
    renderPanel({ ...baseOffer, name: "Table au déjeuner", durationMinutes: 90 });

    const party = await screen.findByLabelText("Nombre de couverts");
    expect(screen.queryByLabelText("Emplacement")).not.toBeInTheDocument();
    // Set in one go: clearing first would snap the field back to its minimum of 1.
    fireEvent.change(party, { target: { value: "4" } });
    await waitFor(() =>
      expect(
        getMock.mock.calls.some(([path]) => path.includes("/table-slots") && path.includes("partySize=4")),
      ).toBe(true),
    );

    await user.click(await screen.findByRole("button", { name: "14:00" }));
    await user.type(screen.getByLabelText("Adresse e-mail"), "kofi@client.test");
    await user.click(screen.getByRole("button", { name: "Confirmer la réservation" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/public/salon/bookings",
        expect.objectContaining({ partySize: 4, startAt: SLOTS[0]!.startAt }),
      ),
    );
    const body = postMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.resourceId).toBeUndefined();
  });

  it("asks the offer's deposit online, and sends the customer to pay it", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/resources")) {
        return Promise.resolve([{ id: "res-1", name: "Fauteuil 1", type: "chair" }]);
      }
      return Promise.resolve({ date: "2026-07-06", durationMinutes: 45, slots: SLOTS });
    });
    postMock.mockResolvedValue({ id: "b-1", status: "confirmed", checkoutUrl: "https://pay.genius.ci/c/MTX-D1" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, set href(value: string) { assign(value); } });
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <BookingPanel
          slug="salon"
          offer={{ ...baseOffer, durationMinutes: 45, depositPercent: 30 }}
          acceptsOnlinePayment
          onClose={() => {}}
          onSuccess={() => {}}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/Un acompte de .*10,50.* \(30 %\) se paie en ligne/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "14:00" }, { timeout: 5_000 }));
    await user.type(screen.getByLabelText("Adresse e-mail"), "awa@client.test");
    await user.click(screen.getByRole("button", { name: "Réserver et payer l'acompte" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://pay.genius.ci/c/MTX-D1"));
    vi.unstubAllGlobals();
  });

  it("chooses the only place by itself instead of asking for it", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/resources")) {
        return Promise.resolve([{ id: "res-1", name: "Résidence Lagune", type: "room" }]);
      }
      return Promise.resolve({ date: "2026-07-06", durationMinutes: 45, slots: SLOTS });
    });
    renderPanel({ ...baseOffer, durationMinutes: 45 });

    expect(await screen.findByRole("button", { name: "14:00" }, { timeout: 5_000 })).toBeInTheDocument();
    expect(screen.queryByLabelText("Emplacement")).not.toBeInTheDocument();
    expect(slotsCalls().some((path) => path.includes("resourceId=res-1"))).toBe(true);
  });

  it("cannot be submitted before a slot is picked, and says so when a day has none", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.endsWith("/resources")) {
        return Promise.resolve([
          { id: "res-1", name: "Fauteuil 1", type: "chair" },
          { id: "res-2", name: "Fauteuil 2", type: "chair" },
        ]);
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

describe("CheckoutPanel — editing the basket", () => {
  /** The real basket hook behind the real dialog, as the shop pages wire them. */
  function Shop() {
    const basket = useCart("maquis");
    return (
      <>
        <button
          type="button"
          onClick={() => basket.addToCart({ id: "garba", name: "Garba", pricing: { amount: 2500 } })}
        >
          add garba
        </button>
        <button
          type="button"
          onClick={() => basket.addToCart({ id: "alloco", name: "Alloco", pricing: { amount: 1000 } })}
        >
          add alloco
        </button>
        <CheckoutPanel
          slug="maquis"
          cart={basket.cart}
          actions={basket}
          currency="XOF"
          acceptedPaymentMethods={["cash"]}
          onClose={() => {}}
          onSuccess={() => {}}
        />
      </>
    );
  }

  function renderShop() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <Shop />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    // This test environment has no Web Storage of its own: an in-memory one, shared across the
    // "reload" below exactly as a browser's would be.
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });
    postMock.mockReset();
    postMock.mockResolvedValue({ id: "order-1", number: "CMD-1" });
  });

  it("changes quantities and removes a line, and orders what is shown", async () => {
    const user = userEvent.setup();
    renderShop();
    await user.click(screen.getByRole("button", { name: "add garba" }));
    await user.click(screen.getByRole("button", { name: "add alloco" }));

    await user.click(screen.getByRole("button", { name: "Ajouter un Garba" }));
    expect(screen.getByText(/Total : 6000.00 XOF/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retirer un Garba" }));
    expect(screen.getByText(/Total : 3500.00 XOF/)).toBeInTheDocument();

    const alloco = screen.getByText("Alloco").closest("li")!;
    await user.click(within(alloco).getByRole("button", { name: "Supprimer" }));
    expect(screen.queryByText("Alloco")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Adresse e-mail"), "kofi@client.ci");
    await user.click(screen.getByRole("button", { name: "Confirmer la commande" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/public/maquis/orders",
        expect.objectContaining({ items: [expect.objectContaining({ offerId: "garba", quantity: 1 })] }),
      ),
    );
  });

  it("puts lines aside, keeps them across a reload, and brings them back", async () => {
    const user = userEvent.setup();
    const { unmount } = renderShop();
    await user.click(screen.getByRole("button", { name: "add garba" }));
    await user.click(screen.getByRole("button", { name: "add alloco" }));

    await user.click(screen.getByRole("button", { name: "Tout mettre de côté" }));
    expect(screen.getByText("Votre panier est vide. Vos articles mis de côté sont ci-dessous.")).toBeInTheDocument();
    expect(screen.getByText("Mis de côté (2)")).toBeInTheDocument();
    // Nothing put aside can be ordered.
    expect(screen.queryByRole("button", { name: "Confirmer la commande" })).not.toBeInTheDocument();

    unmount();
    renderShop();
    const garba = (await screen.findByText("Garba × 1")).closest("li")!;
    await user.click(within(garba).getByRole("button", { name: "Remettre dans le panier" }));
    expect(screen.getByText("Mis de côté (1)")).toBeInTheDocument();
    expect(screen.getByText(/Total : 2500.00 XOF/)).toBeInTheDocument();
  });

  it("asks before emptying the basket", async () => {
    const user = userEvent.setup();
    renderShop();
    await user.click(screen.getByRole("button", { name: "add garba" }));

    await user.click(screen.getByRole("button", { name: "Vider le panier" }));
    expect(screen.getByText("Garba")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Oui, vider le panier" }));
    expect(screen.getByText("Votre panier est vide.")).toBeInTheDocument();
  });
});

describe("CheckoutPanel — online payment", () => {
  function renderOnline(cart: { offerId: string; name: string; unitPrice: number; quantity: number }[], currency: string) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <CheckoutPanel
          slug="boutique"
          cart={cart as unknown as Parameters<typeof CheckoutPanel>[0]["cart"]}
          currency={currency}
          acceptedPaymentMethods={["online", "cash"]}
          onClose={() => {}}
          onSuccess={() => {}}
        />
      </QueryClientProvider>,
    );
  }

  it("tells a customer of a shop in euros what they will pay in CFA francs", () => {
    renderOnline([{ offerId: "o", name: "Sac", unitPrice: 10, quantity: 1 }], "EUR");
    expect(screen.getByText(/vous paierez environ 6\s107 F CFA pour 10.00 EUR/)).toBeInTheDocument();
  });

  it("says nothing of conversion in a shop already in CFA francs", () => {
    renderOnline([{ offerId: "o", name: "Garba", unitPrice: 2500, quantity: 1 }], "XOF");
    expect(screen.queryByText(/francs CFA/)).not.toBeInTheDocument();
  });

  it("refuses online payment under the minimum and offers the other method", () => {
    renderOnline([{ offerId: "o", name: "Eau", unitPrice: 300, quantity: 1 }], "XOF");
    expect(screen.getByText(/Le paiement en ligne commence à 500 XOF/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Payer par mobile money ou carte" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Mobile money ou carte/ })).toBeDisabled();
  });
});

describe("RequestPanel", () => {
  beforeEach(() => {
    postMock.mockReset();
    postMock.mockResolvedValue({ id: "lead-1", status: "new" });
  });

  it("sends a quote request, the offer already named in the message", async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <RequestPanel slug="konan" kind="quote" offerName="Audit comptable" onClose={() => {}} onSuccess={onSuccess} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "Demander un devis" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Bonjour, je souhaite un devis pour « Audit comptable »."))
      .toBeInTheDocument();
    await user.type(screen.getByLabelText("Adresse e-mail"), "kofi@example.com");
    await user.click(screen.getByRole("button", { name: "Envoyer la demande" }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/public/konan/leads", {
        message: "Bonjour, je souhaite un devis pour « Audit comptable ».",
        source: "website_quote",
        contact: { email: "kofi@example.com", firstName: undefined, phone: undefined },
      }),
    );
    expect(onSuccess).toHaveBeenCalled();
  });
});

describe("useCart — signed-in customer", () => {
  it("joins the account's basket to this browser's, and saves the result to the account", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
    });
    store.set("korva-storefront-cart:maquis", JSON.stringify([{ offerId: "garba", name: "Garba", unitPrice: 2500, quantity: 1 }]));
    getMock.mockReset();
    getMock.mockResolvedValue({
      cart: [{ offerId: "alloco", name: "Alloco", unitPrice: 1000, quantity: 2 }],
      saved: [{ offerId: "jus", name: "Jus de bissap", unitPrice: 500, quantity: 1 }],
    });
    const putMock = vi.fn().mockResolvedValue({});
    (publicApiClient as unknown as { put: typeof putMock }).put = putMock;
    const authFetch = <T,>(fn: (token: string) => Promise<T>) => fn("tok");

    function Probe() {
      const basket = useCart("maquis", { isAuthenticated: true, authFetch });
      return (
        <p>
          {basket.cart.map((line) => `${line.name}×${line.quantity}`).join(",")}|
          {basket.saved.map((line) => line.name).join(",")}
        </p>
      );
    }
    render(<Probe />);
    expect(await screen.findByText("Garba×1,Alloco×2|Jus de bissap")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith("/public/maquis/account/basket", "tok");
    await waitFor(
      () =>
        expect(putMock).toHaveBeenCalledWith(
          "/public/maquis/account/basket",
          expect.objectContaining({ cart: expect.arrayContaining([expect.objectContaining({ offerId: "alloco" })]) }),
          "tok",
        ),
      { timeout: 3000 },
    );
    vi.unstubAllGlobals();
  });
});
