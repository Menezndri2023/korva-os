import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AiPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

const conversation = {
  id: "conv-1",
  organizationId: "org-1",
  userId: "user-1",
  agent: "general_assistant",
  createdAt: "2026-08-20T10:00:00.000Z",
  updatedAt: "2026-08-20T10:00:00.000Z",
};

const pendingAction = {
  id: "action-1",
  organizationId: "org-1",
  conversationId: "conv-1",
  toolName: "send_whatsapp",
  input: { to: "+225070000000", body: "hi" },
  status: "pending",
  createdAt: "2026-08-20T10:00:00.000Z",
  updatedAt: "2026-08-20T10:00:00.000Z",
};

function mockGetByPath(overrides: Record<string, unknown> = {}) {
  return (path: string) => {
    if (path === "/ai/conversations") return Promise.resolve([conversation]);
    if (path === "/ai/conversations/conv-1/messages") return Promise.resolve([]);
    if (path === "/ai/conversations/conv-1/pending-actions")
      return Promise.resolve(overrides.pendingActions ?? [pendingAction]);
    throw new Error(`unexpected GET ${path}`);
  };
}

describe("AiPage — pending action confirm/reject", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath());
  });

  async function openConversation(user: ReturnType<typeof userEvent.setup>) {
    renderWithProviders(<AiPage />);
    await user.click(await screen.findByRole("button", { name: "Assistant général" }));
  }

  it("shows the pending action with Confirmer/Rejeter actions", async () => {
    const user = userEvent.setup();
    await openConversation(user);

    expect(await screen.findByText(/Confirmation requise/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rejeter" })).toBeInTheDocument();
  });

  it("confirming successfully calls POST /ai/actions/:id/confirm and refetches", async () => {
    postMock.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    await openConversation(user);

    await user.click(await screen.findByRole("button", { name: "Confirmer" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/ai/actions/action-1/confirm"),
    );
  });

  it("shows a real error message (not a silent failure) when confirm is rejected — e.g. missing WhatsApp consent", async () => {
    postMock.mockRejectedValue(
      new ApiError("WHATSAPP_CONSENT_MISSING", "Ce contact n'a pas donné son consentement WhatsApp"),
    );
    const user = userEvent.setup();
    await openConversation(user);

    await user.click(await screen.findByRole("button", { name: "Confirmer" }));

    expect(
      await screen.findByText("Ce contact n'a pas donné son consentement WhatsApp"),
    ).toBeInTheDocument();
    // The action itself must not disappear or falsely look resolved — its Confirmer/Rejeter
    // buttons must remain available so the user can retry or reject instead.
    expect(screen.getByRole("button", { name: "Confirmer" })).toBeInTheDocument();
  });

  it("shows a real error message when reject fails — e.g. a lost claim race", async () => {
    postMock.mockRejectedValue(
      new ApiError("AI_ACTION_ALREADY_RESOLVED", "This action has already been resolved"),
    );
    const user = userEvent.setup();
    await openConversation(user);

    await user.click(await screen.findByRole("button", { name: "Rejeter" }));

    expect(await screen.findByText("This action has already been resolved")).toBeInTheDocument();
  });

  it("a confirm error on one action never shows on a different action", async () => {
    const secondAction = { ...pendingAction, id: "action-2", toolName: "cancel_booking" };
    getMock.mockImplementation(mockGetByPath({ pendingActions: [pendingAction, secondAction] }));
    postMock.mockImplementation((path: string) =>
      path === "/ai/actions/action-1/confirm"
        ? Promise.reject(new ApiError("WHATSAPP_CONSENT_MISSING", "Consentement manquant"))
        : Promise.resolve({ success: true }),
    );
    const user = userEvent.setup();
    await openConversation(user);

    const confirmButtons = await screen.findAllByRole("button", { name: "Confirmer" });
    await user.click(confirmButtons[0]!);

    expect(await screen.findByText("Consentement manquant")).toBeInTheDocument();
    // Only one error message on screen — it isn't duplicated onto the second action's card.
    expect(screen.getAllByText("Consentement manquant")).toHaveLength(1);
  });

  it("shows a generic French message for a non-ApiError failure", async () => {
    postMock.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    await openConversation(user);

    await user.click(await screen.findByRole("button", { name: "Confirmer" }));

    expect(await screen.findByText(/Une erreur est survenue/)).toBeInTheDocument();
  });
});
