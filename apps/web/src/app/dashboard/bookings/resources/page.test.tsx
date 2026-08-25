import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResourcesPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() } };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

const resourceOne = {
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

const resourceTwo = {
  id: "res-2",
  name: "Véhicule A",
  type: "vehicle",
  capacity: 3,
  active: true,
  weeklyAvailability: [],
  blockedSlots: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function mockResources(resources: unknown[]) {
  getMock.mockImplementation((path: string) => {
    if (path === "/resources") return Promise.resolve(resources);
    throw new Error(`unexpected GET ${path}`);
  });
}

describe("ResourcesPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    mockResources([]);
  });

  it("renders the empty state when there are no resources", async () => {
    renderWithProviders(<ResourcesPage />);
    expect(await screen.findByText("Aucune ressource.")).toBeInTheDocument();
  });

  it("renders resources from GET /resources, with a link to the detail page", async () => {
    mockResources([resourceOne]);
    renderWithProviders(<ResourcesPage />);

    const link = await screen.findByRole("link", { name: "Salle 1" });
    expect(link).toHaveAttribute("href", "/dashboard/bookings/resources/res-1");
    expect(screen.getByText("room")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("formats the weekly availability windows, and shows an em dash when there are none", async () => {
    mockResources([resourceOne, resourceTwo]);
    renderWithProviders(<ResourcesPage />);

    await screen.findByRole("link", { name: "Salle 1" });
    expect(screen.getByText("Lun 09:00-18:00")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("toggles the create form open and closed via the same button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResourcesPage />);

    const toggle = await screen.findByRole("button", { name: "Nouvelle ressource" });
    expect(screen.queryByPlaceholderText("Nom (ex: Salle 1)")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByPlaceholderText("Nom (ex: Salle 1)")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByPlaceholderText("Nom (ex: Salle 1)")).not.toBeInTheDocument();
  });

  it("submits the create form and calls POST /resources with the typed values", async () => {
    postMock.mockResolvedValue(resourceOne);
    const user = userEvent.setup();
    renderWithProviders(<ResourcesPage />);

    await user.click(await screen.findByRole("button", { name: "Nouvelle ressource" }));
    await user.type(screen.getByPlaceholderText("Nom (ex: Salle 1)"), "Salle 2");
    await user.clear(screen.getByPlaceholderText("Type (room, vehicle...)"));
    await user.type(screen.getByPlaceholderText("Type (room, vehicle...)"), "room");
    await user.clear(screen.getByPlaceholderText("Capacité"));
    await user.type(screen.getByPlaceholderText("Capacité"), "5");
    await user.click(screen.getByRole("button", { name: "Créer la ressource" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/resources", {
        name: "Salle 2",
        type: "room",
        capacity: 5,
        active: true,
        weeklyAvailability: [],
      }),
    );
  });

  it("adding a weekly availability slot includes it in the POST payload", async () => {
    postMock.mockResolvedValue(resourceOne);
    const user = userEvent.setup();
    renderWithProviders(<ResourcesPage />);

    await user.click(await screen.findByRole("button", { name: "Nouvelle ressource" }));
    await user.type(screen.getByPlaceholderText("Nom (ex: Salle 1)"), "Salle 2");
    await user.clear(screen.getByPlaceholderText("Type (room, vehicle...)"));
    await user.type(screen.getByPlaceholderText("Type (room, vehicle...)"), "room");
    await user.clear(screen.getByPlaceholderText("Capacité"));
    await user.type(screen.getByPlaceholderText("Capacité"), "5");

    await user.click(screen.getByRole("button", { name: "+ Ajouter un créneau" }));
    await user.click(screen.getByRole("button", { name: "Créer la ressource" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/resources",
        expect.objectContaining({
          weeklyAvailability: [{ dayOfWeek: 1, startTime: "09:00", endTime: "18:00" }],
        }),
      ),
    );
  });

  it("shows a loading state on the submit button while the request is pending", async () => {
    postMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<ResourcesPage />);

    await user.click(await screen.findByRole("button", { name: "Nouvelle ressource" }));
    await user.type(screen.getByPlaceholderText("Nom (ex: Salle 1)"), "Salle 2");
    await user.click(screen.getByRole("button", { name: "Créer la ressource" }));

    expect(await screen.findByRole("button", { name: "Création..." })).toBeDisabled();
  });

  it("on success: closes the form and refetches the resources list", async () => {
    postMock.mockResolvedValue(resourceOne);
    const user = userEvent.setup();
    renderWithProviders(<ResourcesPage />);

    const callsBefore = getMock.mock.calls.filter(([path]) => path === "/resources").length;

    await user.click(await screen.findByRole("button", { name: "Nouvelle ressource" }));
    await user.type(screen.getByPlaceholderText("Nom (ex: Salle 1)"), "Salle 2");
    await user.click(screen.getByRole("button", { name: "Créer la ressource" }));

    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Nom (ex: Salle 1)")).not.toBeInTheDocument(),
    );
    expect(
      getMock.mock.calls.filter(([path]) => path === "/resources").length,
    ).toBeGreaterThan(callsBefore);
  });
});
