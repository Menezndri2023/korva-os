import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CatalogPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, uploadFile } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), getList: vi.fn(), post: vi.fn() },
    uploadFile: vi.fn(),
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

// Mutable through a hoisted holder so each test picks its own organization: the describes above
// rely on there being NO organization (and therefore no trade suggestions), so this cannot be a
// fixed module-level mock.
const orgMock = vi.hoisted(() => ({
  current: undefined as { type?: string; currency?: string } | undefined,
}));
vi.mock("@/lib/use-active-organization", () => ({
  useActiveOrganization: () => ({ data: orgMock.current }),
}));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);
const uploadMock = vi.mocked(uploadFile);

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

  it("sends the uploaded photos with the new offer, main photo first", async () => {
    // The creation form used to send `images: []` unconditionally, while the storefront displays
    // images[0] — so no owner could ever put a photo on their public site.
    uploadMock
      .mockResolvedValueOnce({ url: "https://api.test/u/1.png", filename: "1.png", mimeType: "image/png", size: 1 })
      .mockResolvedValueOnce({ url: "https://api.test/u/2.png", filename: "2.png", mimeType: "image/png", size: 1 });
    postMock.mockResolvedValue({ ...offer, id: "offer-2" });
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />);

    await user.click(screen.getByRole("button", { name: "Nouvelle offre" }));
    await user.type(screen.getByPlaceholderText("Nom"), "Robe");
    await user.upload(screen.getByLabelText("Choisir des photos"), [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.png", { type: "image/png" }),
    ]);
    await user.click(await screen.findByRole("button", { name: "Principale" }));
    await user.click(screen.getByRole("button", { name: "Créer l'offre" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/offers",
        expect.objectContaining({
          images: ["https://api.test/u/2.png", "https://api.test/u/1.png"],
        }),
      ),
    );
  });

  it("asks for a duration only for a booking offer, and sends it", async () => {
    // Without it the storefront asked the customer how long a "Coupe femme" should last.
    postMock.mockResolvedValue({ ...offer, id: "offer-3" });
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />);

    await user.click(screen.getByRole("button", { name: "Nouvelle offre" }));
    expect(screen.queryByLabelText("Durée de la prestation (minutes)")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByDisplayValue("Produit"), "booking");
    await user.type(screen.getByPlaceholderText("Nom"), "Coupe femme");
    await user.type(screen.getByLabelText("Durée de la prestation (minutes)"), "45");
    await user.click(screen.getByRole("button", { name: "Créer l'offre" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/offers",
        expect.objectContaining({ type: "booking", durationMinutes: 45 }),
      ),
    );
  });

  it("shows each offer's main photo in the list", async () => {
    mockOffersPage([{ ...offer, images: ["https://api.test/u/main.png", "https://api.test/u/2.png"] }]);
    const { container } = renderWithProviders(<CatalogPage />);

    await screen.findByRole("link", { name: "Chaise" });
    expect(container.querySelector('img[src="https://api.test/u/main.png"]')).not.toBeNull();
    expect(container.querySelector('img[src="https://api.test/u/2.png"]')).toBeNull();
  });
});

/**
 * An empty catalogue blocks everything downstream — no public site content, nothing to book or
 * order — so the empty state offers what the organization's trade usually sells, read from
 * VERTICAL_TEMPLATES.suggestedOffers. Suggestions only: clicking one pre-fills the creation form
 * and the owner sets the price, because a price is a commercial claim that belongs to them.
 */
describe("CatalogPage — trade suggestions and currency", () => {
  beforeEach(() => {
    getMock.mockReset();
    getMock.mockResolvedValue([]);
    getListMock.mockReset();
    postMock.mockReset();
    mockOffersPage([]);
    orgMock.current = undefined;
  });

  it("offers the trade's catalogue suggestions when the catalogue is empty", async () => {
    orgMock.current = { type: "beauté", currency: "MAD" };
    renderWithProviders(<CatalogPage />);

    expect(await screen.findByText(/Salon & bien-être/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coupe femme" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coloration" })).toBeInTheDocument();
    // The promise that nothing is created behind the owner's back is part of the UI, not just
    // the implementation.
    expect(screen.getByText(/rien n'est créé sans vous/i)).toBeInTheDocument();
  });

  it("falls back to the plain empty state for a trade it cannot recognise", async () => {
    // Organization.type is free-form, so an owner who typed their own sector must not be shown
    // another trade's suggestions.
    orgMock.current = { type: "quelque chose que personne n'a prévu", currency: "EUR" };
    renderWithProviders(<CatalogPage />);
    expect(await screen.findByText("Aucune offre.")).toBeInTheDocument();
  });

  it("pre-fills the creation form from a suggestion without creating anything", async () => {
    orgMock.current = { type: "beauté", currency: "MAD" };
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />);

    await user.click(await screen.findByRole("button", { name: "Coupe femme" }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Nom")).toHaveValue("Coupe femme");
    });
    expect(postMock).not.toHaveBeenCalled();
  });

  it("prices a new offer in the organization's own currency, not EUR", async () => {
    // The form's defaultValues hardcoded "EUR" and are evaluated once on mount, before
    // useActiveOrganization resolves — so every organization got euros, and an offer created in
    // Casablanca or Abidjan was priced in a currency its customers do not use.
    orgMock.current = { type: "beauté", currency: "MAD" };
    postMock.mockResolvedValue({ id: "offer-new" });
    const user = userEvent.setup();
    renderWithProviders(<CatalogPage />);

    await user.click(await screen.findByRole("button", { name: "Coupe femme" }));
    await user.click(screen.getByRole("button", { name: /créer l'offre/i }));

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith(
        "/offers",
        expect.objectContaining({
          name: "Coupe femme",
          type: "booking",
          pricing: expect.objectContaining({ currency: "MAD" }),
        }),
      );
    });
  });
});
