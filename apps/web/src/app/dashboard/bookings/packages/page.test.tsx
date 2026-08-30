import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PackagesPage from "./page";
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

const packageOffer = { id: "offer-1", name: "10-session pass" };
const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

function mockGetByPath(path: string) {
  if (path.startsWith("/contacts")) return Promise.resolve([contact]);
  if (path.startsWith("/offers")) return Promise.resolve([packageOffer]);
  throw new Error(`unexpected GET ${path}`);
}

function mockPackagesPage(
  balances: unknown[],
  pagination = { page: 1, limit: 20, total: balances.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/credit-balances"))
      return Promise.resolve({ data: balances, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("PackagesPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
    mockPackagesPage([]);
  });

  it("renders the toggle button and the empty state", async () => {
    renderWithProviders(<PackagesPage />);
    expect(screen.getByRole("button", { name: "Vendre un forfait" })).toBeInTheDocument();
    expect(await screen.findByText("Aucun forfait vendu.")).toBeInTheDocument();
  });

  it("renders a balance row with the contact, offer and remaining/total credits", async () => {
    mockPackagesPage([
      {
        id: "cb-1",
        contactId: "contact-1",
        offerId: "offer-1",
        totalCredits: 10,
        remainingCredits: 7,
      },
    ]);
    renderWithProviders(<PackagesPage />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("10-session pass")).toBeInTheDocument();
    expect(screen.getByText("7 / 10")).toBeInTheDocument();
  });

  it("submits the top-up form and calls POST /credit-balances/top-up with the typed values", async () => {
    postMock.mockResolvedValue({ id: "cb-1" });
    const user = userEvent.setup();
    renderWithProviders(<PackagesPage />);

    await user.click(screen.getByRole("button", { name: "Vendre un forfait" }));
    await user.selectOptions(screen.getByDisplayValue("Client"), "contact-1");
    await user.selectOptions(screen.getByDisplayValue("Forfait"), "offer-1");
    await user.type(screen.getByPlaceholderText("Nombre de séances"), "10");

    await user.click(screen.getByRole("button", { name: "Créditer le forfait" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/credit-balances/top-up", {
        contactId: "contact-1",
        offerId: "offer-1",
        credits: 10,
      }),
    );
  });

  it("fetches page 1 by default", async () => {
    renderWithProviders(<PackagesPage />);
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/credit-balances?page=1"));
  });
});
