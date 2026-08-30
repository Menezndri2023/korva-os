import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DiscountCodesPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, getList: vi.fn(), post: vi.fn(), patch: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);
const patchMock = vi.mocked(apiClient.patch);

const percentageCode = {
  id: "dc-1",
  organizationId: "org-1",
  code: "SAVE10",
  type: "percentage" as const,
  value: 10,
  redemptionsCount: 2,
  maxRedemptions: 5,
  scope: "all" as const,
  offerIds: [],
  active: true,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

function mockDiscountCodesPage(
  codes: unknown[],
  pagination = { page: 1, limit: 20, total: codes.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/discount-codes")) return Promise.resolve({ data: codes, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("DiscountCodesPage", () => {
  beforeEach(() => {
    getListMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    mockDiscountCodesPage([]);
  });

  it("shows a loading state while fetching", () => {
    getListMock.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<DiscountCodesPage />);
    expect(screen.getByText("Chargement...")).toBeInTheDocument();
  });

  it("renders the empty state", async () => {
    renderWithProviders(<DiscountCodesPage />);
    expect(await screen.findByText("Aucun code promo.")).toBeInTheDocument();
  });

  it("renders a discount code with its type, value and usage count", async () => {
    mockDiscountCodesPage([percentageCode]);
    renderWithProviders(<DiscountCodesPage />);

    expect(await screen.findByText("SAVE10")).toBeInTheDocument();
    expect(screen.getByText("Pourcentage")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Actif")).toBeInTheDocument();
  });

  it("submits the create form and calls POST /discount-codes with the typed values", async () => {
    postMock.mockResolvedValue(percentageCode);
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodesPage />);

    await user.click(screen.getByRole("button", { name: "Nouveau code" }));
    await user.type(screen.getByPlaceholderText("Code (ex: PROMO10)"), "PROMO10");
    await user.type(screen.getByPlaceholderText("Valeur (%)"), "15");
    await user.click(screen.getByRole("button", { name: "Créer le code" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/discount-codes", {
        code: "PROMO10",
        type: "percentage",
        value: 15,
        scope: "all",
        offerIds: [],
        active: true,
      }),
    );
  });

  it("switches the amount placeholder and shows a currency field when type is fixed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodesPage />);

    await user.click(screen.getByRole("button", { name: "Nouveau code" }));
    await user.selectOptions(screen.getByRole("combobox"), "fixed");

    expect(screen.getByPlaceholderText("Montant")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Devise (EUR)")).toBeInTheDocument();
  });

  it("deactivates an active code via PATCH /discount-codes/:id", async () => {
    mockDiscountCodesPage([percentageCode]);
    patchMock.mockResolvedValue({ ...percentageCode, active: false });
    const user = userEvent.setup();
    renderWithProviders(<DiscountCodesPage />);

    await user.click(await screen.findByRole("button", { name: "Désactiver" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/discount-codes/dc-1", { active: false }),
    );
  });

  it("fetches page 1 by default", async () => {
    renderWithProviders(<DiscountCodesPage />);
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/discount-codes?page=1"));
  });
});
