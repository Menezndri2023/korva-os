import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CourseDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, useParams: () => ({ id: "course-1" }) };
});

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: { ...actual.apiClient, get: vi.fn(), getList: vi.fn(), post: vi.fn(), patch: vi.fn() },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);

const member = {
  id: "member-1",
  userId: { firstName: "Sophie", lastName: "Martin", email: "sophie@example.com" },
};

const course = {
  id: "course-1",
  organizationId: "org-1",
  name: "Développement Web",
  status: "draft" as const,
  offerId: "offer-1",
  modules: [
    { title: "Introduction", instructorMembershipId: "member-1" },
    { title: "Projet final" },
  ],
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

const cohort = {
  id: "cohort-1",
  organizationId: "org-1",
  courseId: "course-1",
  name: "Promo Septembre",
  startDate: "2026-09-01T00:00:00.000Z",
  status: "upcoming" as const,
  enrolledContactIds: ["contact-1"],
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
};

const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

function defaultGet(path: string) {
  if (path === "/courses/course-1") return Promise.resolve(course);
  if (path === "/contacts") return Promise.resolve([contact]);
  if (path === "/resources") return Promise.resolve([]);
  if (path === "/organizations/me/members") return Promise.resolve([member]);
  if (path === "/quizzes?courseId=course-1") return Promise.resolve([]);
  throw new Error(`unexpected GET ${path}`);
}

describe("CourseDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(defaultGet);
    getListMock.mockImplementation((path: string) => {
      if (path.startsWith("/cohorts")) {
        return Promise.resolve({
          data: [cohort],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }
      throw new Error(`unexpected getList ${path}`);
    });
  });

  it("renders the course name, modules with instructor names, and cohorts", async () => {
    renderWithProviders(<CourseDetailPage />);

    expect(await screen.findByRole("heading", { name: "Développement Web" })).toBeInTheDocument();
    expect(screen.getByText(/0\. Introduction/)).toHaveTextContent("Sophie Martin");
    expect(screen.getByText(/1\. Projet final/)).toBeInTheDocument();
    expect(screen.getByText("Promo Septembre")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("submits a new cohort with the selected enrollees", async () => {
    postMock.mockResolvedValue(cohort);
    const user = userEvent.setup();
    renderWithProviders(<CourseDetailPage />);
    await screen.findByRole("heading", { name: "Développement Web" });

    await user.click(screen.getByRole("button", { name: "Nouvelle promotion" }));
    await user.type(screen.getByPlaceholderText("Nom de la promotion"), "Promo Octobre");
    fireEvent.change(screen.getByLabelText("Date de début"), {
      target: { value: "2026-10-01" },
    });
    await user.click(screen.getByLabelText("Ada Lovelace"));
    await user.click(screen.getByRole("button", { name: "Créer la promotion" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/cohorts",
        expect.objectContaining({
          courseId: "course-1",
          name: "Promo Octobre",
          enrolledContactIds: ["contact-1"],
        }),
      ),
    );
  });

  it("shows the assigned instructor's name next to a scheduled session", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/cohorts/cohort-1/sessions") {
        return Promise.resolve([
          {
            id: "session-1",
            moduleIndex: 0,
            startAt: "2026-09-10T10:00:00.000Z",
            bookingIds: ["b1"],
            instructorMembershipId: "member-1",
          },
        ]);
      }
      return defaultGet(path);
    });
    renderWithProviders(<CourseDetailPage />);

    expect(await screen.findByText(/Module 0/)).toHaveTextContent("Sophie Martin");
  });

  it("schedules a session for a cohort's module", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/resources") {
        return Promise.resolve([{ id: "resource-1", name: "Salle A" }]);
      }
      return defaultGet(path);
    });
    getListMock.mockImplementation((path: string) => {
      if (path.startsWith("/cohorts")) {
        return Promise.resolve({
          data: [cohort],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        });
      }
      throw new Error(`unexpected getList ${path}`);
    });
    postMock.mockResolvedValue({ id: "session-1", moduleIndex: 0, bookingIds: ["b1"] });
    const user = userEvent.setup();
    renderWithProviders(<CourseDetailPage />);
    await screen.findByText("Promo Septembre");

    await user.click(screen.getByRole("button", { name: "Planifier une session" }));
    await user.selectOptions(screen.getByDisplayValue("Salle..."), "resource-1");
    fireEvent.change(screen.getByLabelText("Début"), {
      target: { value: "2026-09-10T10:00" },
    });
    fireEvent.change(screen.getByLabelText("Fin"), {
      target: { value: "2026-09-10T12:00" },
    });

    await user.click(screen.getByRole("button", { name: "Planifier" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith(
      "/cohorts/cohort-1/sessions",
      expect.objectContaining({ resourceId: "resource-1" }),
    ));
  });
});
