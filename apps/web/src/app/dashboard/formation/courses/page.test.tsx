import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CoursesPage from "./page";
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

const offer = {
  id: "offer-1",
  name: "Session de formation",
  pricing: { amount: 100, currency: "EUR" },
};

const course = {
  id: "course-1",
  organizationId: "org-1",
  name: "Développement Web",
  status: "draft" as const,
  offerId: "offer-1",
  modules: [{ title: "Introduction" }, { title: "Projet final" }],
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

function mockCoursesPage(
  courses: unknown[],
  pagination = { page: 1, limit: 20, total: courses.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/courses")) return Promise.resolve({ data: courses, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

describe("CoursesPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation((path: string) => {
      if (path === "/offers") return Promise.resolve([offer]);
      throw new Error(`unexpected GET ${path}`);
    });
    mockCoursesPage([]);
  });

  it("renders the empty state", async () => {
    renderWithProviders(<CoursesPage />);
    expect(await screen.findByText("Aucun programme.")).toBeInTheDocument();
  });

  it("renders a course with its status and module count", async () => {
    mockCoursesPage([course]);
    renderWithProviders(<CoursesPage />);

    expect(await screen.findByText("Développement Web")).toBeInTheDocument();
    expect(screen.getByText("Brouillon")).toBeInTheDocument();
    expect(screen.getByText("2 module(s)")).toBeInTheDocument();
  });

  it("submits the create form with name, offer, and modules", async () => {
    postMock.mockResolvedValue(course);
    const user = userEvent.setup();
    renderWithProviders(<CoursesPage />);
    await screen.findByText("Aucun programme.");

    await user.click(screen.getByRole("button", { name: "Nouveau programme" }));
    await user.type(screen.getByPlaceholderText("Nom du programme"), "Développement Web");
    await user.selectOptions(
      screen.getByDisplayValue("Offre associée (session facturable)..."),
      "offer-1",
    );
    await user.click(screen.getByRole("button", { name: "+ Ajouter un module" }));
    await user.type(screen.getByPlaceholderText("Module 1"), "Introduction");
    await user.click(screen.getByRole("button", { name: "Créer le programme" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/courses", {
        name: "Développement Web",
        offerId: "offer-1",
        modules: [{ title: "Introduction" }],
      }),
    );
  });
});
