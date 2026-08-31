import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecurringBillingPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: vi.fn(),
      getList: vi.fn(),
      post: vi.fn(),
    },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);

const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };
const offer = {
  id: "offer-1",
  name: "Abonnement mensuel",
  pricing: { amount: 49, currency: "EUR" },
};

const plan = {
  id: "plan-1",
  organizationId: "org-1",
  contactId: "contact-1",
  offerId: "offer-1",
  interval: "monthly" as const,
  status: "active" as const,
  amount: 49,
  currency: "EUR",
  nextBillingDate: "2026-09-30T00:00:00.000Z",
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
};

function mockPlansPage(
  plans: unknown[],
  pagination = { page: 1, limit: 20, total: plans.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/recurring-billing")) return Promise.resolve({ data: plans, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("RecurringBillingPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path === "/contacts") return Promise.resolve([contact]);
      if (path === "/offers") return Promise.resolve([offer]);
      throw new Error(`unexpected GET ${path}`);
    });
    mockPlansPage([]);
  });

  it("renders the empty state", async () => {
    renderWithProviders(<RecurringBillingPage />);
    expect(await screen.findByText("Aucun abonnement.")).toBeInTheDocument();
  });

  it("renders a plan with resolved contact and offer names", async () => {
    mockPlansPage([plan]);
    renderWithProviders(<RecurringBillingPage />);

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Abonnement mensuel")).toBeInTheDocument();
    expect(screen.getByText("Mensuel")).toBeInTheDocument();
    expect(screen.getByText("49 EUR")).toBeInTheDocument();
    expect(screen.getByText("Actif")).toBeInTheDocument();
  });

  it("submits the create form with the selected contact, offer, and interval", async () => {
    postMock.mockResolvedValue(plan);
    const user = userEvent.setup();
    renderWithProviders(<RecurringBillingPage />);
    await screen.findByText("Aucun abonnement.");

    await user.click(screen.getByRole("button", { name: "Nouvel abonnement" }));
    await user.selectOptions(screen.getByDisplayValue("Client..."), "contact-1");
    await user.selectOptions(screen.getByDisplayValue("Offre..."), "offer-1");
    await user.click(screen.getByRole("button", { name: "Créer l'abonnement" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/recurring-billing", {
        contactId: "contact-1",
        offerId: "offer-1",
        interval: "monthly",
      }),
    );
  });

  it("cancels an active plan", async () => {
    mockPlansPage([plan]);
    postMock.mockResolvedValue({ ...plan, status: "cancelled" });
    const user = userEvent.setup();
    renderWithProviders(<RecurringBillingPage />);
    await screen.findByText("Ada Lovelace");

    await user.click(screen.getByRole("button", { name: "Annuler" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/recurring-billing/plan-1/cancel", {}),
    );
  });

  it("does not show the cancel action for an already-cancelled plan", async () => {
    mockPlansPage([{ ...plan, status: "cancelled" }]);
    renderWithProviders(<RecurringBillingPage />);
    await screen.findByText("Ada Lovelace");

    expect(screen.queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
  });
});
