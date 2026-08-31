import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import ActivitiesPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), getList: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);

const contact = { id: "contact-1", firstName: "Camille", lastName: "Durand", tags: [] };
const lead = { id: "lead-1", contactId: "contact-1", status: "open", pipelineId: "p1", stageId: "s1", customFields: {}, createdAt: "", updatedAt: "" };

function mockGetByPath(path: string) {
  if (path.startsWith("/contacts")) return Promise.resolve([contact]);
  if (path.startsWith("/leads")) return Promise.resolve([lead]);
  throw new Error(`unexpected get ${path}`);
}

function mockActivitiesPage(
  activities: unknown[],
  pagination = { page: 1, limit: 20, total: activities.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/activities/recent")) return Promise.resolve({ data: activities, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("ActivitiesPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
    mockActivitiesPage([]);
  });

  it("renders the empty state", async () => {
    renderWithProviders(<ActivitiesPage />);
    expect(
      await screen.findByText("Aucune activité enregistrée pour le moment."),
    ).toBeInTheDocument();
  });

  it("shows an activity linked back to its contact (resolved directly for a contact entity)", async () => {
    mockActivitiesPage([
      {
        id: "act-1",
        entity: "contact",
        entityId: "contact-1",
        type: "call",
        content: "Appel de confirmation",
        createdAt: "2026-01-15T09:00:00.000Z",
      },
    ]);
    renderWithProviders(<ActivitiesPage />);

    expect(await screen.findByText("call")).toBeInTheDocument();
    expect(screen.getByText("Appel de confirmation")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Camille Durand" })).toHaveAttribute(
      "href",
      "/dashboard/crm/contact-1",
    );
  });

  it("resolves a lead-entity activity back to the lead's own contact", async () => {
    mockActivitiesPage([
      {
        id: "act-2",
        entity: "lead",
        entityId: "lead-1",
        type: "note",
        createdAt: "2026-01-15T09:00:00.000Z",
      },
    ]);
    renderWithProviders(<ActivitiesPage />);

    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Camille Durand" })).toHaveAttribute(
        "href",
        "/dashboard/crm/contact-1",
      ),
    );
  });

  it("fetches page 1 by default", async () => {
    renderWithProviders(<ActivitiesPage />);
    await waitFor(() =>
      expect(getListMock).toHaveBeenCalledWith("/activities/recent?page=1"),
    );
  });
});
