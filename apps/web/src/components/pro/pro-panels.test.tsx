import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";
import { InsightsPanel } from "./insights-panel";
import { ExportPanel } from "./export-panel";
import { PrioritySupportCard } from "./priority-support-card";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn() } };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));
const getMock = vi.mocked(apiClient.get);

function onPlan(key: string, routes: Record<string, unknown> = {}) {
  getMock.mockImplementation(async (path: string) => {
    if (path === "/subscriptions/me") return { plan: { key }, subscription: {} };
    const match = Object.keys(routes).find((prefix) => path.startsWith(prefix));
    return match ? routes[match] : [];
  });
}

const insights = {
  periodDays: 30,
  currency: "XOF",
  ordersRevenue: { current: 30000, previous: 20000 },
  ordersCount: { current: 2, previous: 2 },
  averageOrder: { current: 15000, previous: 10000 },
  bookingsValue: { current: 0, previous: 0 },
  bookingsCount: { current: 0, previous: 0 },
  newContacts: { current: 3, previous: 0 },
  topCustomers: [{ contactId: "c-1", name: "Awa Koné", total: 30000, count: 2 }],
  topOffers: [{ offerId: "o-1", name: "Pagne wax", total: 30000, quantity: 2 }],
};

describe("InsightsPanel", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("compares the period with the one before and names the best customers and sales", async () => {
    onPlan("pro", { "/analytics/insights": insights });
    renderWithProviders(<InsightsPanel days={30} showOrders showBookings={false} />);
    expect(await screen.findByText("Awa Koné")).toBeInTheDocument();
    expect(screen.getByText("Pagne wax")).toBeInTheDocument();
    // Sales and average basket both rose by half.
    expect(screen.getAllByText("+50 % vs 30 jours précédents")).toHaveLength(2);
    expect(screen.getByText("Nouveau vs 30 jours précédents")).toBeInTheDocument();
    expect(screen.queryByText("Réservations")).not.toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith("/analytics/insights?days=30");
  });

  it("invites a Starter business to Pro instead of loading anything", async () => {
    onPlan("starter");
    renderWithProviders(<InsightsPanel days={30} showOrders showBookings />);
    expect(await screen.findByRole("link", { name: "Passer à Pro" })).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalledWith("/analytics/insights?days=30");
  });
});

describe("ExportPanel", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("saves the file the API prepared, and locks the sales journal below Business", async () => {
    const createObjectURL = vi.fn(() => "blob:x");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    onPlan("pro", {
      "/exports/orders": { filename: "shop-orders.csv", csv: "﻿Date;Numéro\r\n", rows: 4, truncated: false },
    });
    renderWithProviders(<ExportPanel kinds={["orders", "contacts", "sales-journal"]} />);

    const journal = await screen.findByRole("button", { name: "Journal des ventes (comptable)" });
    await waitFor(() => expect(journal).toBeDisabled());
    expect(screen.getByText(/Formule Business/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Réservations" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Commandes" }));
    expect(await screen.findByText("4 lignes exportées.")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(expect.stringMatching(/^\/exports\/orders\?from=\d{4}-\d{2}-\d{2}&to=/));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
    click.mockRestore();
  });
});

describe("PrioritySupportCard", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("gives Business the direct WhatsApp and e-mail line to KORVA", async () => {
    onPlan("business");
    renderWithProviders(<PrioritySupportCard />);
    expect(await screen.findByRole("link", { name: /WhatsApp/ })).toHaveAttribute(
      "href",
      "https://wa.me/212607742672",
    );
    expect(screen.getByRole("link", { name: "contact@vit-global.tech" })).toHaveAttribute(
      "href",
      "mailto:contact@vit-global.tech",
    );
  });

  it("shows nothing below Business", async () => {
    onPlan("pro");
    const { container } = renderWithProviders(<PrioritySupportCard />);
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/subscriptions/me"));
    expect(container).toBeEmptyDOMElement();
  });
});
