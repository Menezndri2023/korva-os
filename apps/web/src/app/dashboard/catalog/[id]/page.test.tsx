import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OfferDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "offer-1" }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), patch: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const patchMock = vi.mocked(apiClient.patch);

const offer = {
  id: "offer-1",
  type: "product" as const,
  name: "Chaise",
  description: "Une belle chaise",
  images: [],
  categories: ["mobilier"],
  pricing: { amount: 50, currency: "EUR" },
  sku: "CH-1",
  variants: [{ id: "var-1", name: "Rouge", sku: "CH-1-R", priceOverride: 55 }],
  status: "active" as const,
  customFields: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mockGetByPath(path: string) {
  if (path === "/offers/offer-1") return Promise.resolve(offer);
  throw new Error(`unexpected GET ${path}`);
}

describe("OfferDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
  });

  it("shows the offer name, sku, price, description, categories and variants", async () => {
    renderWithProviders(<OfferDetailPage />);

    expect(await screen.findByRole("heading", { name: "Chaise" })).toBeInTheDocument();
    expect(screen.getByText("CH-1")).toBeInTheDocument();
    expect(screen.getByText("50,00 €")).toBeInTheDocument();
    expect(screen.getByText("Une belle chaise")).toBeInTheDocument();
    expect(screen.getByText("mobilier")).toBeInTheDocument();
    expect(screen.getByText("Rouge")).toBeInTheDocument();
  });

  it("shows a message and a link back when the offer does not exist", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/offers/offer-1") {
        return Promise.reject(new ApiError("OFFER_NOT_FOUND", "Offer not found"));
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<OfferDetailPage />);

    expect(await screen.findByText("Offer not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour au catalogue" })).toHaveAttribute(
      "href",
      "/dashboard/catalog",
    );
  });

  it("opens the edit form prefilled and submits PATCH with the typed values", async () => {
    patchMock.mockResolvedValue(offer);
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    await user.click(screen.getByRole("button", { name: "Modifier" }));
    expect(screen.getByPlaceholderText("Nom")).toHaveValue("Chaise");

    await user.clear(screen.getByPlaceholderText("Nom"));
    await user.type(screen.getByPlaceholderText("Nom"), "Chaise longue");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/offers/offer-1", {
        type: "product",
        sku: "CH-1",
        name: "Chaise longue",
        description: "Une belle chaise",
        pricing: { amount: 50, currency: "EUR" },
        status: "active",
      }),
    );
  });

  it("does not show a delete action", async () => {
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    expect(screen.queryByRole("button", { name: /supprimer/i })).not.toBeInTheDocument();
  });
});
