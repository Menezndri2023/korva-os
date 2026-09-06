import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ActionCenterPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

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

const summary = { pendingApprovals: 1, recommendations: 1, automatedThisWeek: 24, failures: 2 };

const recommendationItem = {
  type: "recommendation",
  id: "rec-1",
  title: "Client inactif à relancer",
  description: "Inactif depuis 61 jours.",
  occurredAt: "2026-01-03T00:00:00.000Z",
  entityType: "contact",
  entityId: "contact-1",
  severity: "opportunity",
  impact: "61 jours d'inactivité",
};

const pendingApprovalItem = {
  type: "pending_approval",
  id: "pa-1",
  title: "Confirmation requise : send_whatsapp",
  occurredAt: "2026-01-02T00:00:00.000Z",
  severity: "urgent",
};

const failureItem = {
  type: "workflow_failure",
  id: "exec-1",
  title: 'Échec d\'automatisation pour l\'événement "lead.created"',
  description: "Webhook URL resolves to a disallowed address",
  occurredAt: "2026-01-01T00:00:00.000Z",
  severity: "attention",
};

function mockResponses(feed: unknown[]) {
  getMock.mockImplementation((path: string) => {
    if (path === "/action-center/summary") return Promise.resolve(summary);
    if (path === "/action-center/feed") return Promise.resolve(feed);
    throw new Error(`unexpected get ${path}`);
  });
}

describe("ActionCenterPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    mockResponses([]);
  });

  it("renders the four summary tiles", async () => {
    renderWithProviders(<ActionCenterPage />);
    expect(await screen.findByText("Approbations")).toBeInTheDocument();
    expect(screen.getAllByText("1")).toHaveLength(2); // pendingApprovals + recommendations
    expect(screen.getByText("24")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the empty state when the feed is empty", async () => {
    renderWithProviders(<ActionCenterPage />);
    expect(
      await screen.findByText("Rien ne nécessite votre attention pour le moment."),
    ).toBeInTheDocument();
  });

  it("renders items from every source in the feed", async () => {
    mockResponses([recommendationItem, pendingApprovalItem, failureItem]);
    renderWithProviders(<ActionCenterPage />);

    expect(await screen.findByText("Client inactif à relancer")).toBeInTheDocument();
    expect(screen.getByText("Confirmation requise : send_whatsapp")).toBeInTheDocument();
    expect(
      screen.getByText('Échec d\'automatisation pour l\'événement "lead.created"'),
    ).toBeInTheDocument();
  });

  it("groups items into severity sections (Phase B1)", async () => {
    mockResponses([recommendationItem, pendingApprovalItem, failureItem]);
    renderWithProviders(<ActionCenterPage />);

    await screen.findByText("Client inactif à relancer");
    expect(screen.getByText("Urgent")).toBeInTheDocument();
    expect(screen.getByText("À surveiller")).toBeInTheDocument();
    expect(screen.getByText("Opportunité")).toBeInTheDocument();
    expect(screen.getByText("· 61 jours d'inactivité")).toBeInTheDocument();
  });

  it("only shows resolve/dismiss actions for recommendation items", async () => {
    mockResponses([recommendationItem, pendingApprovalItem, failureItem]);
    renderWithProviders(<ActionCenterPage />);

    await screen.findByText("Client inactif à relancer");
    expect(screen.getAllByRole("button", { name: "Résolue" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Ignorer" })).toHaveLength(1);
  });

  it("resolving a recommendation item calls the resolve endpoint", async () => {
    mockResponses([recommendationItem]);
    postMock.mockResolvedValue({ ...recommendationItem, status: "resolved" });
    const user = userEvent.setup();
    renderWithProviders(<ActionCenterPage />);

    await screen.findByText("Client inactif à relancer");
    await user.click(screen.getByRole("button", { name: "Résolue" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/recommendations/rec-1/resolve"),
    );
  });
});
