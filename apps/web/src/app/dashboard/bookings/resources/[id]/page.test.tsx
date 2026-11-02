import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResourceDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "res-1" }),
}));

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

const resource = {
  id: "res-1",
  name: "Salle 1",
  type: "room",
  capacity: 10,
  active: true,
  weeklyAvailability: [{ dayOfWeek: 1, startTime: "09:00", endTime: "18:00" }],
  blockedSlots: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mockGetByPath(path: string) {
  if (path === "/resources/res-1") return Promise.resolve(resource);
  if (path === "/organizations/me/members") return Promise.resolve([]);
  throw new Error(`unexpected GET ${path}`);
}

describe("ResourceDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
  });

  it("shows the resource name, type, capacity and active badge", async () => {
    renderWithProviders(<ResourceDetailPage />);

    expect(await screen.findByRole("heading", { name: "Salle 1" })).toBeInTheDocument();
    // The kind reads as words now, not the API key "room".
    expect(screen.getByText("Salle 1").nextElementSibling).toHaveTextContent(
      "Lieu (salle, cabine, table, chambre) · capacité 10",
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("shows a message and a link back when the resource does not exist", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/resources/res-1") {
        return Promise.reject(new ApiError("RESOURCE_NOT_FOUND", "Resource not found"));
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<ResourceDetailPage />);

    expect(await screen.findByText("Resource not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour aux ressources" })).toHaveAttribute(
      "href",
      "/dashboard/bookings/resources",
    );
  });

  it("opens the edit form prefilled with the existing weekly slot and submits PATCH", async () => {
    patchMock.mockResolvedValue(resource);
    const user = userEvent.setup();
    renderWithProviders(<ResourceDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    await user.click(screen.getByRole("button", { name: "Modifier" }));
    expect(screen.getByPlaceholderText("Nom")).toHaveValue("Salle 1");

    await user.clear(screen.getByPlaceholderText("Nom"));
    await user.type(screen.getByPlaceholderText("Nom"), "Salle 1 (rénovée)");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/resources/res-1", {
        name: "Salle 1 (rénovée)",
        type: "room",
        capacity: 10,
        active: true,
        weeklyAvailability: [{ dayOfWeek: 1, startTime: "09:00", endTime: "18:00" }],
      }),
    );
  });

  it("shows the empty blocked-slots message when there are none", async () => {
    renderWithProviders(<ResourceDetailPage />);
    expect(await screen.findByText("Aucune indisponibilité.")).toBeInTheDocument();
  });

  it("lists existing blocked slots with a reason", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/resources/res-1") {
        return Promise.resolve({
          ...resource,
          blockedSlots: [
            {
              id: "slot-1",
              startAt: "2026-02-01T09:00:00.000Z",
              endAt: "2026-02-01T10:00:00.000Z",
              reason: "Maintenance",
            },
          ],
        });
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<ResourceDetailPage />);

    expect(await screen.findByText(/Maintenance/)).toBeInTheDocument();
  });

  it("adds a blocked slot via POST /resources/:id/blocked-slots with an ISO range", async () => {
    postMock.mockResolvedValue(resource);
    const user = userEvent.setup();
    renderWithProviders(<ResourceDetailPage />);
    await screen.findByRole("heading", { name: "Salle 1" });

    await user.type(screen.getByLabelText("Date"), "2026-02-01");
    await user.type(screen.getByLabelText("Début"), "09:00");
    await user.type(screen.getByLabelText("Fin"), "10:00");
    await user.type(screen.getByLabelText("Raison"), "Maintenance");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/resources/res-1/blocked-slots", {
        startAt: new Date("2026-02-01T09:00:00.000Z").toISOString(),
        endAt: new Date("2026-02-01T10:00:00.000Z").toISOString(),
        reason: "Maintenance",
      }),
    );
  });

  it("removes a blocked slot via DELETE /resources/:id/blocked-slots/:slotId", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/resources/res-1") {
        return Promise.resolve({
          ...resource,
          blockedSlots: [
            { id: "slot-1", startAt: "2026-02-01T09:00:00.000Z", endAt: "2026-02-01T10:00:00.000Z" },
          ],
        });
      }
      return mockGetByPath(path);
    });
    deleteMock.mockResolvedValue(resource);
    const user = userEvent.setup();
    renderWithProviders(<ResourceDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Retirer" }));

    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith("/resources/res-1/blocked-slots/slot-1"),
    );
  });
});
