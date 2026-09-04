import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SuppliersPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

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

const supplier = {
  id: "supplier-1",
  organizationId: "org-1",
  name: "Acme Supplies",
  email: "contact@acme.test",
  phone: "0102030405",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("SuppliersPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    getMock.mockResolvedValue([]);
  });

  it("shows an empty state when there are no suppliers", async () => {
    renderWithProviders(<SuppliersPage />);
    expect(await screen.findByText("Aucun fournisseur.")).toBeInTheDocument();
  });

  it("renders suppliers from the response", async () => {
    getMock.mockResolvedValue([supplier]);
    renderWithProviders(<SuppliersPage />);
    expect(await screen.findByText("Acme Supplies")).toBeInTheDocument();
    expect(screen.getByText("contact@acme.test")).toBeInTheDocument();
  });

  it("filters by the search input", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SuppliersPage />);
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/suppliers"));

    await user.type(screen.getByPlaceholderText("Rechercher un fournisseur..."), "acme");
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/suppliers?search=acme"),
    );
  });

  it("creates a supplier via the dialog form", async () => {
    postMock.mockResolvedValue(supplier);
    const user = userEvent.setup();
    renderWithProviders(<SuppliersPage />);

    await user.click(screen.getByRole("button", { name: "Nouveau fournisseur" }));
    await user.type(screen.getByPlaceholderText("Nom"), "Acme Supplies");
    await user.type(screen.getByPlaceholderText("Email"), "contact@acme.test");
    await user.click(screen.getByRole("button", { name: "Créer" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/suppliers", {
        name: "Acme Supplies",
        email: "contact@acme.test",
      }),
    );
  });

  it("edits a supplier via the dialog form", async () => {
    getMock.mockResolvedValue([supplier]);
    patchMock.mockResolvedValue({ ...supplier, phone: "0708091011" });
    const user = userEvent.setup();
    renderWithProviders(<SuppliersPage />);

    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "Modifier" }));
    const phoneInput = screen.getByPlaceholderText("Téléphone");
    await user.clear(phoneInput);
    await user.type(phoneInput, "0708091011");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        "/suppliers/supplier-1",
        expect.objectContaining({ phone: "0708091011" }),
      ),
    );
  });

  it("deletes a supplier after confirmation", async () => {
    getMock.mockResolvedValue([supplier]);
    deleteMock.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderWithProviders(<SuppliersPage />);

    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/suppliers/supplier-1"));
  });

  it("shows a clear message when deletion is blocked by an active purchase order", async () => {
    getMock.mockResolvedValue([supplier]);
    deleteMock.mockRejectedValue(
      new ApiError("SUPPLIER_IN_USE", "Supplier still has an active PO"),
    );
    const user = userEvent.setup();
    renderWithProviders(<SuppliersPage />);

    await screen.findByText("Acme Supplies");
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    expect(
      await screen.findByText(
        "Ce fournisseur a encore une commande fournisseur active et ne peut pas être supprimé.",
      ),
    ).toBeInTheDocument();
  });
});
