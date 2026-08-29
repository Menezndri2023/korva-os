import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CategoriesPage from "./page";
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

const category = {
  id: "cat-1",
  organizationId: "org-1",
  name: "Vêtements",
  description: "Habits et accessoires",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("CategoriesPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    getMock.mockResolvedValue([]);
  });

  it("shows a loading state while categories are fetched", async () => {
    let resolveGet!: (value: unknown[]) => void;
    getMock.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    renderWithProviders(<CategoriesPage />);
    expect(screen.getByText("Chargement...")).toBeInTheDocument();

    resolveGet([]);
    await screen.findByText("Aucune catégorie pour le moment.");
  });

  it("renders the empty state with an explanation when there are no categories", async () => {
    renderWithProviders(<CategoriesPage />);
    expect(await screen.findByText("Aucune catégorie pour le moment.")).toBeInTheDocument();
    expect(
      screen.getByText(/regrouper vos offres pour mieux les organiser/),
    ).toBeInTheDocument();
  });

  it("renders categories from the list response", async () => {
    getMock.mockResolvedValue([category]);
    renderWithProviders(<CategoriesPage />);

    expect(await screen.findByText("Vêtements")).toBeInTheDocument();
    expect(screen.getByText("Habits et accessoires")).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith("/categories");
  });

  it("creates a category and submits the correct body", async () => {
    const user = userEvent.setup();
    postMock.mockResolvedValue(category);
    renderWithProviders(<CategoriesPage />);

    await screen.findByText("Aucune catégorie pour le moment.");
    await user.click(screen.getByRole("button", { name: "Nouvelle catégorie" }));

    await user.type(screen.getByPlaceholderText("Nom"), "Vêtements");
    await user.type(screen.getByPlaceholderText("Description"), "Habits et accessoires");
    await user.click(screen.getByRole("button", { name: "Créer" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/categories", {
        name: "Vêtements",
        description: "Habits et accessoires",
      }),
    );
  });

  it("edits a category and submits the updated fields", async () => {
    getMock.mockResolvedValue([category]);
    const user = userEvent.setup();
    patchMock.mockResolvedValue({ ...category, name: "Accessoires" });
    renderWithProviders(<CategoriesPage />);

    await screen.findByText("Vêtements");
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    const nameInput = screen.getByDisplayValue("Vêtements");
    await user.clear(nameInput);
    await user.type(nameInput, "Accessoires");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        "/categories/cat-1",
        expect.objectContaining({ name: "Accessoires" }),
      ),
    );
  });

  it("deletes a category after confirmation", async () => {
    getMock.mockResolvedValue([category]);
    const user = userEvent.setup();
    deleteMock.mockResolvedValue({ deleted: true });
    renderWithProviders(<CategoriesPage />);

    await screen.findByText("Vêtements");
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/categories/cat-1"));
  });

  it("shows a friendly message when deletion is blocked because the category is in use", async () => {
    getMock.mockResolvedValue([category]);
    const user = userEvent.setup();
    deleteMock.mockRejectedValue(
      new ApiError(
        "CATEGORY_IN_USE",
        "This category is still referenced by one or more offers and cannot be deleted",
      ),
    );
    renderWithProviders(<CategoriesPage />);

    await screen.findByText("Vêtements");
    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer" }));

    expect(
      await screen.findByText(
        "Cette catégorie est encore utilisée par une ou plusieurs offres et ne peut pas être supprimée.",
      ),
    ).toBeInTheDocument();
  });
});
