import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageTemplatesPage from "./page";
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

const template = {
  id: "template-1",
  name: "Bienvenue",
  channel: "email" as const,
  subject: "Bienvenue {{contact.firstName}}",
  body: "Bonjour, merci de votre inscription.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("MessageTemplatesPage — edit and delete", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/message-templates")) return Promise.resolve([template]);
      throw new Error(`unexpected GET ${path}`);
    });
  });

  it("renders the template row", async () => {
    renderWithProviders(<MessageTemplatesPage />);
    expect(await screen.findByText("Bienvenue")).toBeInTheDocument();
  });

  it("opens the edit form prefilled and submits PATCH with the typed values", async () => {
    patchMock.mockResolvedValue(template);
    const user = userEvent.setup();
    renderWithProviders(<MessageTemplatesPage />);
    await screen.findByText("Bienvenue");

    await user.click(screen.getByRole("button", { name: "Modifier" }));
    expect(screen.getByPlaceholderText("Nom du modèle")).toHaveValue("Bienvenue");

    await user.clear(screen.getByPlaceholderText("Nom du modèle"));
    await user.type(screen.getByPlaceholderText("Nom du modèle"), "Bienvenue v2");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/message-templates/template-1", {
        name: "Bienvenue v2",
        channel: "email",
        subject: "Bienvenue {{contact.firstName}}",
        body: "Bonjour, merci de votre inscription.",
      }),
    );
  });

  it("first click on Supprimer shows Confirmer ?/Annuler and sends no DELETE", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MessageTemplatesPage />);
    await screen.findByText("Bienvenue");

    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    expect(screen.getByRole("button", { name: "Confirmer ?" })).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("confirming sends DELETE /message-templates/:id and refetches the list", async () => {
    deleteMock.mockResolvedValue({ deleted: true });
    const user = userEvent.setup();
    renderWithProviders(<MessageTemplatesPage />);
    await screen.findByText("Bienvenue");

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith("/message-templates/template-1"));
  });

  it("cancelling the confirmation sends no DELETE", async () => {
    const user = userEvent.setup();
    renderWithProviders(<MessageTemplatesPage />);
    await screen.findByText("Bienvenue");

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("on delete error: shows the message and resets the confirmation", async () => {
    deleteMock.mockRejectedValue(new ApiError("SOME_ERROR", "Une erreur inattendue"));
    const user = userEvent.setup();
    renderWithProviders(<MessageTemplatesPage />);
    await screen.findByText("Bienvenue");

    await user.click(screen.getByRole("button", { name: "Supprimer" }));
    await user.click(screen.getByRole("button", { name: "Confirmer ?" }));

    expect(await screen.findByText("Une erreur inattendue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
  });
});
