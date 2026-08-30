import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExpensesPage from "./page";
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
      delete: vi.fn(),
    },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);
const deleteMock = vi.mocked(apiClient.delete);

const expense = {
  id: "expense-1",
  organizationId: "org-1",
  number: "EXP-1",
  status: "recorded" as const,
  category: "Fournitures",
  description: "Papier et encre",
  amount: 42.5,
  currency: "XOF",
  date: "2026-08-27T00:00:00.000Z",
  vendor: "Papeterie du coin",
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:00.000Z",
};

function mockExpensesPage(
  expenses: unknown[],
  pagination = { page: 1, limit: 20, total: expenses.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/expenses")) return Promise.resolve({ data: expenses, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("ExpensesPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    deleteMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path === "/contacts") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
    mockExpensesPage([]);
  });

  it("shows a loading state while fetching", async () => {
    getListMock.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<ExpensesPage />);
    expect(screen.getByText("Chargement...")).toBeInTheDocument();
  });

  it("renders the empty state explaining what expenses are", async () => {
    renderWithProviders(<ExpensesPage />);
    expect(await screen.findByText("Aucune dépense.")).toBeInTheDocument();
    expect(
      screen.getByText(/Enregistrez votre première dépense pour commencer à les suivre\./),
    ).toBeInTheDocument();
  });

  it("renders expenses from the paginated response", async () => {
    mockExpensesPage([expense]);
    renderWithProviders(<ExpensesPage />);

    expect(await screen.findByText("EXP-1")).toBeInTheDocument();
    expect(screen.getByText("Fournitures")).toBeInTheDocument();
    expect(screen.getByText("Papier et encre")).toBeInTheDocument();
    expect(screen.getByText("42.5 XOF")).toBeInTheDocument();
    expect(screen.getByText("Papeterie du coin")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByText("Enregistrée")).toBeInTheDocument();
  });

  it("fetches page 1 with no status filter by default", async () => {
    renderWithProviders(<ExpensesPage />);
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/expenses?page=1"));
  });

  it("shows the page count from the response", async () => {
    mockExpensesPage([expense], { page: 1, limit: 20, total: 45, totalPages: 3 });
    renderWithProviders(<ExpensesPage />);

    expect(await screen.findByText("Page 1 sur 3")).toBeInTheDocument();
  });

  it("clicking Suivant fetches the next page", async () => {
    mockExpensesPage([expense], { page: 1, limit: 20, total: 45, totalPages: 3 });
    const user = userEvent.setup();
    renderWithProviders(<ExpensesPage />);

    await screen.findByText("Page 1 sur 3");
    mockExpensesPage([expense], { page: 2, limit: 20, total: 45, totalPages: 3 });
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/expenses?page=2"));
  });

  it("changing the status filter resets to page 1 and includes the status param", async () => {
    mockExpensesPage([expense], { page: 1, limit: 20, total: 45, totalPages: 3 });
    const user = userEvent.setup();
    renderWithProviders(<ExpensesPage />);

    await screen.findByText("Page 1 sur 3");
    mockExpensesPage([expense], { page: 2, limit: 20, total: 45, totalPages: 3 });
    await user.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/expenses?page=2"));

    await user.selectOptions(screen.getByDisplayValue("Tous les statuts"), "voided");

    await waitFor(() =>
      expect(getListMock).toHaveBeenCalledWith("/expenses?page=1&status=voided"),
    );
  });

  describe("create flow", () => {
    it("submits the exact body shape, converting the native date input to an ISO datetime", async () => {
      postMock.mockResolvedValue(expense);
      const user = userEvent.setup();
      renderWithProviders(<ExpensesPage />);
      await screen.findByText("Aucune dépense.");

      await user.click(screen.getByRole("button", { name: "Nouvelle dépense" }));

      await user.type(screen.getByPlaceholderText("Catégorie"), "Fournitures");
      await user.type(screen.getByPlaceholderText("Fournisseur (optionnel)"), "Papeterie du coin");
      await user.type(screen.getByPlaceholderText("Description"), "Papier et encre");
      await user.type(screen.getByPlaceholderText("Montant"), "42.5");
      await user.clear(screen.getByPlaceholderText("Devise (EUR)"));
      await user.type(screen.getByPlaceholderText("Devise (EUR)"), "XOF");
      fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-27" } });
      await user.type(screen.getByPlaceholderText("Notes (optionnel)"), "Achat mensuel");

      await user.click(screen.getByRole("button", { name: "Enregistrer la dépense" }));

      await waitFor(() =>
        expect(postMock).toHaveBeenCalledWith("/expenses", {
          category: "Fournitures",
          vendor: "Papeterie du coin",
          description: "Papier et encre",
          amount: 42.5,
          currency: "XOF",
          date: "2026-08-27T00:00:00.000Z",
          notes: "Achat mensuel",
          billable: false,
        }),
      );
    });

    it("closes the form and refetches the list on success", async () => {
      postMock.mockResolvedValue(expense);
      const user = userEvent.setup();
      renderWithProviders(<ExpensesPage />);
      await screen.findByText("Aucune dépense.");

      await user.click(screen.getByRole("button", { name: "Nouvelle dépense" }));
      await user.type(screen.getByPlaceholderText("Catégorie"), "Fournitures");
      await user.type(screen.getByPlaceholderText("Description"), "Papier");
      await user.type(screen.getByPlaceholderText("Montant"), "10");
      fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-08-27" } });

      mockExpensesPage([expense]);
      await user.click(screen.getByRole("button", { name: "Enregistrer la dépense" }));

      await waitFor(() =>
        expect(screen.queryByPlaceholderText("Catégorie")).not.toBeInTheDocument(),
      );
    });
  });

  describe("void action", () => {
    it("requires a confirmation click before voiding", async () => {
      mockExpensesPage([expense]);
      const user = userEvent.setup();
      renderWithProviders(<ExpensesPage />);
      await screen.findByText("EXP-1");

      await user.click(screen.getByRole("button", { name: "Annuler" }));
      expect(screen.getByRole("button", { name: "Confirmer ?" })).toBeInTheDocument();
      expect(postMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Confirmer ?" }));
      await waitFor(() =>
        expect(postMock).toHaveBeenCalledWith("/expenses/expense-1/void"),
      );
    });

    it("does not show the void action for an already-voided expense", async () => {
      mockExpensesPage([{ ...expense, status: "voided" }]);
      renderWithProviders(<ExpensesPage />);
      await screen.findByText("EXP-1");

      expect(screen.queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
    });
  });

  describe("delete flow", () => {
    it("opens a confirmation dialog and sends no DELETE until confirmed", async () => {
      mockExpensesPage([expense]);
      const user = userEvent.setup();
      renderWithProviders(<ExpensesPage />);
      await screen.findByText("EXP-1");

      await user.click(screen.getByRole("button", { name: "Supprimer" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(deleteMock).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Confirmer ?" }));
      await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/expenses/expense-1"));
    });

    it("cancelling the dialog sends no DELETE", async () => {
      mockExpensesPage([expense]);
      const user = userEvent.setup();
      renderWithProviders(<ExpensesPage />);
      await screen.findByText("EXP-1");

      await user.click(screen.getByRole("button", { name: "Supprimer" }));
      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Annuler" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(deleteMock).not.toHaveBeenCalled();
    });
  });

  describe("billable expenses and invoice generation", () => {
    it("shows the client select only once billable is checked", async () => {
      getMock.mockImplementation((path: string) => {
        if (path === "/contacts") {
          return Promise.resolve([
            { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] },
          ]);
        }
        throw new Error(`unexpected GET ${path}`);
      });
      const user = userEvent.setup();
      renderWithProviders(<ExpensesPage />);

      await user.click(screen.getByRole("button", { name: "Nouvelle dépense" }));
      expect(screen.queryByText("Choisir un client")).not.toBeInTheDocument();

      await user.click(screen.getByLabelText("Refacturable au client"));
      expect(screen.getByText("Choisir un client")).toBeInTheDocument();
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    });

    it("selecting a billable, recorded expense's checkbox reveals a 'Générer une facture' action that calls the endpoint with the selected id", async () => {
      mockExpensesPage([
        { ...expense, id: "expense-2", billable: true, status: "recorded" },
      ]);
      postMock.mockResolvedValue({ id: "invoice-1" });
      const user = userEvent.setup();
      renderWithProviders(<ExpensesPage />);
      await screen.findByText("EXP-1");

      await user.click(screen.getByRole("checkbox", { name: /Sélectionner/ }));
      await user.click(screen.getByRole("button", { name: "Générer une facture" }));

      await waitFor(() =>
        expect(postMock).toHaveBeenCalledWith("/expenses/generate-invoice", {
          expenseIds: ["expense-2"],
        }),
      );
    });

    it("does not show a selection checkbox for a non-billable or already-invoiced expense", async () => {
      mockExpensesPage([
        { ...expense, id: "e-a", number: "EXP-A", billable: false, status: "recorded" },
        { ...expense, id: "e-b", number: "EXP-B", billable: true, status: "invoiced" },
      ]);
      renderWithProviders(<ExpensesPage />);
      await screen.findByText("EXP-A");
      await screen.findByText("EXP-B");

      expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });
  });
});
