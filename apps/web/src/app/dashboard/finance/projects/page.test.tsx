import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), getList: vi.fn(), post: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);

const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

const project = {
  id: "project-1",
  organizationId: "org-1",
  contactId: "contact-1",
  name: "Refonte du site",
  status: "active" as const,
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

function mockProjectsPage(
  projects: unknown[],
  pagination = { page: 1, limit: 20, total: projects.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/projects")) return Promise.resolve({ data: projects, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("ProjectsPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path === "/contacts") return Promise.resolve([contact]);
      throw new Error(`unexpected GET ${path}`);
    });
    mockProjectsPage([]);
  });

  it("renders the empty state", async () => {
    renderWithProviders(<ProjectsPage />);
    expect(await screen.findByText("Aucun projet.")).toBeInTheDocument();
  });

  it("renders a project with the resolved contact name", async () => {
    mockProjectsPage([project]);
    renderWithProviders(<ProjectsPage />);

    expect(await screen.findByText("Refonte du site")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Actif")).toBeInTheDocument();
  });

  it("submits the create form with the selected contact and name", async () => {
    postMock.mockResolvedValue(project);
    const user = userEvent.setup();
    renderWithProviders(<ProjectsPage />);
    await screen.findByText("Aucun projet.");

    await user.click(screen.getByRole("button", { name: "Nouveau projet" }));
    await user.selectOptions(screen.getByDisplayValue("Client..."), "contact-1");
    await user.type(screen.getByPlaceholderText("Nom du projet"), "Refonte du site");
    await user.click(screen.getByRole("button", { name: "Créer le projet" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/projects", {
        contactId: "contact-1",
        name: "Refonte du site",
      }),
    );
  });
});
