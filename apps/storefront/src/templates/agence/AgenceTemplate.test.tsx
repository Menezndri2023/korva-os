import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PublicOffer, PublicOrganization } from "@/lib/public-types";
import type { StorefrontTemplateProps } from "../types";
import { AgenceTemplate } from "./AgenceTemplate";
import { SejourTemplate } from "../sejour/SejourTemplate";

vi.mock("@/app/[slug]/wishlist-button", () => ({ WishlistButton: () => null }));

const organization = {
  name: "Immo Lagune",
  slug: "immo",
  businessModel: "real_estate",
  acceptedPaymentMethods: [],
} as unknown as PublicOrganization;

function offer(id: string, name: string, amount: number, attributes: Record<string, string>, extra: Partial<PublicOffer> = {}): PublicOffer {
  return {
    id,
    type: "service",
    name,
    images: [],
    categories: [],
    pricing: { amount, currency: "XOF" },
    variants: [],
    attributes,
    ...extra,
  };
}

function props(overrides: Partial<StorefrontTemplateProps>): StorefrontTemplateProps {
  return {
    slug: "immo",
    organization,
    catalogVisible: true,
    offers: [],
    offersLoading: false,
    offersError: false,
    onRetryOffers: vi.fn(),
    bookingEnabled: true,
    commerceEnabled: false,
    onBook: vi.fn(),
    onAddToCart: vi.fn(),
    cartCount: 0,
    onOpenCheckout: vi.fn(),
    confirmation: null,
    authHydrated: true,
    isAuthenticated: false,
    ...overrides,
  };
}

function renderWith(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

describe("AgenceTemplate", () => {
  const listings = [
    offer("a", "Appartement Cocody", 250_000, { Transaction: "Location", "Type de bien": "Appartement", "Surface (m²)": "85", Pièces: "3", Quartier: "Cocody" }),
    offer("b", "Villa Riviera", 150_000_000, { Transaction: "Vente", "Type de bien": "Villa", "Surface (m²)": "320", Quartier: "Riviera" }),
  ];

  it("shows each listing's facts, a monthly rent and the transaction badge", () => {
    renderWith(<AgenceTemplate {...props({ offers: listings })} />);
    const flat = screen.getByText("Appartement Cocody").closest("li")!;
    expect(within(flat).getByText("À louer")).toBeInTheDocument();
    expect(within(flat).getByText("/ mois")).toBeInTheDocument();
    expect(within(flat).getByText("Appartement · 85 m² · 3 pièces")).toBeInTheDocument();
    expect(screen.getByText("2 biens")).toBeInTheDocument();
  });

  it("filters listings by transaction, then clears the filters", async () => {
    const user = userEvent.setup();
    renderWith(<AgenceTemplate {...props({ offers: listings })} />);

    await user.selectOptions(screen.getByLabelText("Transaction"), "sale");
    expect(screen.queryByText("Appartement Cocody")).not.toBeInTheDocument();
    expect(screen.getByText("Villa Riviera")).toBeInTheDocument();
    expect(screen.getByText("1 bien")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Effacer les filtres" }));
    expect(screen.getByText("Appartement Cocody")).toBeInTheDocument();
  });

  it("says so when no listing matches", async () => {
    const user = userEvent.setup();
    renderWith(<AgenceTemplate {...props({ offers: listings })} />);
    await user.type(screen.getByLabelText(/Surface minimum/), "1000");
    expect(screen.getByText("Aucun bien ne correspond à ces critères.")).toBeInTheDocument();
  });
});

describe("SejourTemplate", () => {
  it("shows a room's capacity, amenities and nightly price, and books it", async () => {
    const user = userEvent.setup();
    const onBook = vi.fn();
    const room = offer(
      "r1",
      "Chambre Lagune",
      35_000,
      { "Capacité (personnes)": "2", Lits: "1 lit double", Équipements: "Wi-Fi, Climatisation, Piscine, Parking, Télévision" },
      { type: "booking", bookingUnit: "night" },
    );
    renderWith(
      <SejourTemplate {...props({ organization: { ...organization, businessModel: "lodging" }, offers: [room], onBook })} />,
    );

    const card = screen.getByText("Chambre Lagune").closest("li")!;
    expect(within(card).getByText("2 pers. · 1 lit double")).toBeInTheDocument();
    expect(within(card).getByText("Climatisation")).toBeInTheDocument();
    expect(within(card).getByText("+ 1")).toBeInTheDocument();
    expect(within(card).getByText("/ nuit")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Réserver" }));
    expect(onBook).toHaveBeenCalledWith(room);
  });
});
