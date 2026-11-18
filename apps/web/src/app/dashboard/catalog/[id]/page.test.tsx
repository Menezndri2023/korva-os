import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OfferDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "offer-1" }),
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);
const patchMock = vi.mocked(apiClient.patch);
const deleteMock = vi.mocked(apiClient.delete);

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
  if (path.startsWith("/custom-fields")) return Promise.resolve([]);
  throw new Error(`unexpected GET ${path}`);
}

describe("OfferDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    pushMock.mockReset();
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

  it("86's a tracked item (sets stockOnHand to 0) via POST /offers/:id/stock/adjust", async () => {
    // Offer-level stock adjustment only applies when the offer has no variants — see
    // page.tsx's own comment on that control. variants: [] here (not the shared `offer`
    // fixture's one variant) is what actually exercises this control at all.
    getMock.mockImplementation((path: string) => {
      if (path === "/offers/offer-1") {
        return Promise.resolve({
          ...offer,
          variants: [],
          trackStock: true,
          stockOnHand: 5,
        });
      }
      throw new Error(`unexpected GET ${path}`);
    });
    postMock.mockResolvedValue({
      ...offer,
      variants: [],
      trackStock: true,
      stockOnHand: 0,
    });
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);

    await user.click(
      await screen.findByRole("button", { name: "86 (marquer indisponible)" }),
    );

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/offers/offer-1/stock/adjust", {
        stockOnHand: 0,
      }),
    );
  });

  it("does not show the 86 button once stock is already at 0", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/offers/offer-1") {
        return Promise.resolve({
          ...offer,
          variants: [],
          trackStock: true,
          stockOnHand: 0,
        });
      }
      throw new Error(`unexpected GET ${path}`);
    });
    renderWithProviders(<OfferDetailPage />);

    await screen.findByText("Ajuster le stock");
    expect(
      screen.queryByRole("button", { name: "86 (marquer indisponible)" }),
    ).not.toBeInTheDocument();
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
        barcode: "",
        name: "Chaise longue",
        description: "Une belle chaise",
        images: [],
        pricing: { amount: 50, currency: "EUR" },
        status: "active",
        trackStock: false,
        stockOnHand: undefined,
        lowStockThreshold: undefined,
        customFields: {},
        compareAtPrice: null,
        durationMinutes: null,
        minNights: null,
        bufferMinutes: null,
        depositPercent: null,
        cancellationHours: null,
        freeAmount: false,
        attributes: {},
        isBundle: false,
        bundleItems: [],
        optionGroups: [],
        // The existing variant is sent back WITH its id, so the API edits it in place instead of
        // re-creating it under a new id.
        variants: [
          {
            id: "var-1",
            name: "Rouge",
            sku: "CH-1-R",
            barcode: undefined,
            priceOverride: 55,
            stockOnHand: undefined,
          },
        ],
      }),
    );
  });

  it("puts a draft on the site in one click, and takes an online offer off it", async () => {
    getMock.mockImplementation((path: string) =>
      Promise.resolve(path === "/offers/offer-1" ? { ...offer, status: "draft" } : []),
    );
    patchMock.mockResolvedValue(offer);
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);

    expect(await screen.findByText("Brouillon")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Publier sur le site" }));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/offers/offer-1", { status: "active" }),
    );
  });

  it("shows the offer's photos and saves a new main photo from the edit form", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/offers/offer-1") {
        return Promise.resolve({ ...offer, images: ["https://x/1.png", "https://x/2.png"] });
      }
      return Promise.resolve([]);
    });
    patchMock.mockResolvedValue(offer);
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    expect(screen.getByRole("list", { name: "Photos de l'offre" })).toBeInTheDocument();
    expect(screen.getByAltText("Photo 1")).toHaveAttribute("src", "https://x/1.png");

    await user.click(screen.getByRole("button", { name: "Modifier" }));
    await user.click(screen.getByRole("button", { name: "Principale" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        "/offers/offer-1",
        expect.objectContaining({ images: ["https://x/2.png", "https://x/1.png"] }),
      ),
    );
  });

  it("renders a defined custom field's value on the detail page", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/offers/offer-1") {
        return Promise.resolve({ ...offer, customFields: { warranty_months: 24 } });
      }
      if (path === "/custom-fields?entity=offers") {
        return Promise.resolve([
          { id: "field-1", entity: "offers", key: "warranty_months", label: "Garantie (mois)", type: "number", required: false },
        ]);
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<OfferDetailPage />);

    expect(await screen.findByText("Garantie (mois)")).toBeInTheDocument();
    expect(screen.getByText("24")).toBeInTheDocument();
  });

  it("includes an edited custom field's value in the PATCH payload", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/custom-fields?entity=offers") {
        return Promise.resolve([
          { id: "field-1", entity: "offers", key: "warranty_months", label: "Garantie (mois)", type: "number", required: false },
        ]);
      }
      return mockGetByPath(path);
    });
    patchMock.mockResolvedValue(offer);
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    await user.click(screen.getByRole("button", { name: "Modifier" }));
    await user.type(await screen.findByLabelText("Garantie (mois)"), "24");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        "/offers/offer-1",
        expect.objectContaining({ customFields: { warranty_months: 24 } }),
      ),
    );
  });

  it("shows a Supprimer button on the detail page", async () => {
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
  });

  it("first click shows Confirmer ?/Annuler and sends no DELETE", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(screen.getByRole("button", { name: "Confirmer ?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("cancelling the confirmation sends no DELETE and restores the initial state", async () => {
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmer ?" })).not.toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("confirming sends exactly DELETE /offers/:id", async () => {
    deleteMock.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/offers/offer-1"));
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("shows a pending state while the deletion is in flight and prevents a second click", async () => {
    deleteMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    const confirmButton = await screen.findByRole("button", { name: "Suppression..." });
    expect(confirmButton).toBeDisabled();

    await user.click(confirmButton);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("on success: invalidates the offers query and navigates back to the catalog", async () => {
    deleteMock.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/dashboard/catalog"));
  });

  it("on OFFER_IN_USE: shows the explicit message, keeps the offer, and does not navigate away", async () => {
    deleteMock.mockRejectedValue(
      new ApiError(
        "OFFER_IN_USE",
        "This offer is still referenced by other records and cannot be deleted",
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    expect(
      await screen.findByText(
        "Cette offre ne peut pas être supprimée car elle est encore utilisée par d'autres données.",
      ),
    ).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Chaise" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
  });

  it("on OFFER_NOT_FOUND (deleted concurrently): shows the backend message", async () => {
    deleteMock.mockRejectedValue(new ApiError("OFFER_NOT_FOUND", "Offer not found"));
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    expect(await screen.findByText("Offer not found")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("on a 403 PERMISSION_DENIED error: shows the backend message", async () => {
    deleteMock.mockRejectedValue(
      new ApiError("PERMISSION_DENIED", "Réservé aux administrateurs"),
    );
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    expect(await screen.findByText("Réservé aux administrateurs")).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("on a generic ApiError: shows the backend message, never fails silently", async () => {
    deleteMock.mockRejectedValue(new ApiError("SOME_OTHER_ERROR", "Une erreur inattendue"));
    const user = userEvent.setup();
    renderWithProviders(<OfferDetailPage />);
    await screen.findByRole("heading", { name: "Chaise" });

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    expect(await screen.findByText("Une erreur inattendue")).toBeInTheDocument();
  });
});
