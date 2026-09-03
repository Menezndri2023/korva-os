import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CatalogPage from "./page";
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

const offer = {
  id: "offer-1",
  type: "product" as const,
  name: "Chaise",
  images: [],
  categories: [],
  pricing: { amount: 50, currency: "EUR" },
  variants: [],
  status: "active" as const,
  customFields: {},
};

function mockOffersPage(
  offers: unknown[],
  pagination = { page: 1, limit: 20, total: offers.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/offers")) return Promise.resolve({ data: offers, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("CatalogPage — pagination", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue([]);
    getListMock.mockReset();
    postMock.mockReset();
    mockOffersPage([]);
  });

  it("renders the empty state when there are no offers", async () => {
    renderWithProviders(<CatalogPage />);
    expect(await screen.findByText("Aucune offre.")).toBeInTheDocument();
  });

  it("renders offers from the paginated response", async () => {
    mockOffersPage([offer]);
    renderWithProviders(<CatalogPage />);
    expect(await screen.findByText("Chaise")).toBeInTheDocument();
  });

  it("fetches page 1 with no type filter by default", async () => {
    renderWithProviders(<CatalogPage />);
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/offers?page=1"));
  });

  it("shows the page count from the response", async () => {
    mockOffersPage([offer], { page: 1, limit: 20, total: 45, totalPages: 3 });
    renderWithProviders(<CatalogPage />);

    expect(await screen.findByText("Page 1 sur 3")).toBeInTheDocument();
  });

  it("clicking Suivant fetches the next page", async () => {
    mockOffersPage([offer], { page: 1, limit: 20, total: 45, totalPages: 3 });
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />);

    await screen.findByText("Page 1 sur 3");
    mockOffersPage([offer], { page: 2, limit: 20, total: 45, totalPages: 3 });
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/offers?page=2"));
    expect(await screen.findByText("Page 2 sur 3")).toBeInTheDocument();
  });

  it("changing the type filter resets to page 1 and includes the type param", async () => {
    mockOffersPage([offer], { page: 1, limit: 20, total: 45, totalPages: 3 });
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />);

    await screen.findByText("Page 1 sur 3");
    mockOffersPage([offer], { page: 2, limit: 20, total: 45, totalPages: 3 });
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/offers?page=2"));

    await user.selectOptions(screen.getByDisplayValue("Tous les types"), "service");

    await waitFor(() =>
      expect(getListMock).toHaveBeenCalledWith("/offers?page=1&type=service"),
    );
  });

  it("includes a defined custom field's typed value in the create payload", async () => {
    getMock.mockResolvedValue([
      { id: "field-1", entity: "offers", key: "warranty_months", label: "Garantie (mois)", type: "number", required: false },
    ]);
    postMock.mockResolvedValue({ ...offer, id: "offer-2" });
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />);

    await user.click(screen.getByRole("button", { name: "Nouvelle offre" }));
    await user.type(screen.getByPlaceholderText("Nom"), "Table");
    await user.type(await screen.findByLabelText("Garantie (mois)"), "24");
    await user.click(screen.getByRole("button", { name: "Créer l'offre" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/offers",
        expect.objectContaining({ customFields: { warranty_months: 24 } }),
      ),
    );
  });
});
