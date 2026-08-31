import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useParams: () => ({ id: "project-1" }) };
});

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), patch: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const patchMock = vi.mocked(apiClient.patch);

const summary = {
  project: {
    id: "project-1",
    organizationId: "org-1",
    contactId: "contact-1",
    name: "Refonte du site",
    status: "active" as const,
    budgetHours: 40,
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  },
  totalHoursLogged: 12,
  billableHoursLogged: 10,
  totalBilled: 800,
  openTaskCount: 2,
  totalTaskCount: 5,
};

const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

describe("ProjectDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path === `/projects/project-1/summary`) return Promise.resolve(summary);
      if (path === "/contacts") return Promise.resolve([contact]);
      throw new Error(`unexpected GET ${path}`);
    });
  });

  it("renders the project name, contact, and aggregated summary figures", async () => {
    renderWithProviders(<ProjectDetailPage />);

    expect(await screen.findByText("Refonte du site")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("12h")).toBeInTheDocument();
    expect(screen.getByText("10h")).toBeInTheDocument();
    expect(screen.getByText(/800/)).toBeInTheDocument();
    expect(screen.getByText("3/5")).toBeInTheDocument();
    expect(screen.getByText("2 en cours")).toBeInTheDocument();
  });

  it("changes the project status via the select", async () => {
    patchMock.mockResolvedValue({ ...summary.project, status: "on_hold" });
    const user = userEvent.setup();
    renderWithProviders(<ProjectDetailPage />);
    await screen.findByText("Refonte du site");

    await user.selectOptions(screen.getByDisplayValue("Actif"), "on_hold");

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/projects/project-1", { status: "on_hold" }),
    );
  });
});
