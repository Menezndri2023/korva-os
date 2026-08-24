import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WorkflowsPage from "./page";
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
const deleteMock = vi.mocked(apiClient.delete);

const workflow = {
  id: "workflow-1",
  name: "Bienvenue automatique",
  trigger: "lead.created",
  active: true,
  conditions: [],
  actions: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("WorkflowsPage — confirm before deleting", () => {
  beforeEach(() => {
    getMock.mockReset();
    deleteMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/workflows")) return Promise.resolve([workflow]);
      throw new Error(`unexpected GET ${path}`);
    });
  });

  it("renders the workflow row", async () => {
    renderWithProviders(<WorkflowsPage />);
    expect(await screen.findByText("Bienvenue automatique")).toBeInTheDocument();
  });

  it("first click on Supprimer shows Confirmer ?/Annuler and sends no DELETE", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkflowsPage />);
    await screen.findByText("Bienvenue automatique");

    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(screen.getByRole("button", { name: "Confirmer ?" })).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("confirming sends DELETE /workflows/:id", async () => {
    deleteMock.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderWithProviders(<WorkflowsPage />);
    await screen.findByText("Bienvenue automatique");

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/workflows/workflow-1"));
  });

  it("cancelling the confirmation sends no DELETE", async () => {
    const user = userEvent.setup();
    renderWithProviders(<WorkflowsPage />);
    await screen.findByText("Bienvenue automatique");

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("on delete error: shows the backend message near the row", async () => {
    deleteMock.mockRejectedValue(new ApiError("SOME_ERROR", "Une erreur inattendue"));
    const user = userEvent.setup();
    renderWithProviders(<WorkflowsPage />);
    await screen.findByText("Bienvenue automatique");

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    expect(await screen.findByText("Une erreur inattendue")).toBeInTheDocument();
  });
});
