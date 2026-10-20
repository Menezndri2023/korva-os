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
    if (path === "/organizations/me/members") return Promise.resolve([]);
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
    expect(screen.getByText("Lieu (salle, cabine, table, chambre)")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("formats the weekly availability windows, and shows an em dash when there are none", async () => {
    mockResources([resourceOne, resourceTwo]);
    renderWithProviders(<ResourcesPage />);

    await screen.findByRole("link", { name: "Salle 1" });
    expect(screen.getByText("Lun 09:00-18:00")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("toggles the create form open and closed via the same button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResourcesPage />);

    const toggle = await screen.findByRole("button", { name: "Nouvelle ressource" });
    expect(screen.queryByLabelText("Nom")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByLabelText("Nom")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByLabelText("Nom")).not.toBeInTheDocument();
  });

  it("submits the create form and calls POST /resources with the typed values", async () => {
    postMock.mockResolvedValue(resourceOne);
    const user = userEvent.setup();
    renderWithProviders(<ResourcesPage />);

    await user.click(await screen.findByRole("button", { name: "Nouvelle ressource" }));
    await user.type(screen.getByLabelText("Nom"), "Salle 2");
    await user.selectOptions(screen.getByLabelText("Nature"), "room");
    await user.clear(screen.getByLabelText("Capacité"));
    await user.type(screen.getByLabelText("Capacité"), "5");
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
    await user.type(screen.getByLabelText("Nom"), "Salle 2");
    await user.selectOptions(screen.getByLabelText("Nature"), "room");
    await user.clear(screen.getByLabelText("Capacité"));
    await user.type(screen.getByLabelText("Capacité"), "5");

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
    await user.type(screen.getByLabelText("Nom"), "Salle 2");
    await user.click(screen.getByRole("button", { name: "Créer la ressource" }));

    expect(await screen.findByRole("button", { name: "Création..." })).toBeDisabled();
  });

  it("on success: closes the form and refetches the resources list", async () => {
    postMock.mockResolvedValue(resourceOne);
    const user = userEvent.setup();
    renderWithProviders(<ResourcesPage />);

    const callsBefore = getMock.mock.calls.filter(([path]) => path === "/resources").length;

    await user.click(await screen.findByRole("button", { name: "Nouvelle ressource" }));
    await user.type(screen.getByLabelText("Nom"), "Salle 2");
    await user.click(screen.getByRole("button", { name: "Créer la ressource" }));

    await waitFor(() =>
      expect(screen.queryByLabelText("Nom")).not.toBeInTheDocument(),
    );
    expect(
      getMock.mock.calls.filter(([path]) => path === "/resources").length,
    ).toBeGreaterThan(callsBefore);
  });

  it("defaults to a team member, with a first-name prompt, a photo and no account needed", async () => {
    postMock.mockResolvedValue(resourceOne);
    const user = userEvent.setup();
    renderWithProviders(<ResourcesPage />);

    expect(await screen.findByText(/ne compte pas comme utilisateur/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nouvelle ressource" }));
    expect(screen.getByLabelText("Nature")).toHaveValue("person");
    expect(screen.getByPlaceholderText("Prénom (ex: Awa)")).toBeInTheDocument();
    expect(screen.getByLabelText("Photo")).toBeInTheDocument();
    expect(screen.getByLabelText("Compte utilisateur lié")).toHaveValue("");

    await user.type(screen.getByLabelText("Nom"), "Awa");
    await user.type(screen.getByLabelText("Présentation"), "Coloriste, 10 ans d'expérience");
    await user.click(screen.getByRole("button", { name: "Créer la ressource" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/resources",
        expect.objectContaining({
          name: "Awa",
          type: "person",
          description: "Coloriste, 10 ans d'expérience",
        }),
      ),
    );
    const body = postMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(body.membershipId).toBeUndefined();
  });

  it("hides the photo and the account link for a place", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ResourcesPage />);

    await user.click(await screen.findByRole("button", { name: "Nouvelle ressource" }));
    await user.selectOptions(screen.getByLabelText("Nature"), "room");
    expect(screen.getByPlaceholderText("Nom (ex: Salle 1)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Photo")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Compte utilisateur lié")).not.toBeInTheDocument();
  });
});
