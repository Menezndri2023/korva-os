import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LeadsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: vi.fn(),
      getList: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
    },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);

function mockLeadsPage(
  leads: unknown[],
  pagination = { page: 1, limit: 20, total: leads.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/leads")) return Promise.resolve({ data: leads, pagination });
    throw new Error(`unexpected getList ${path}`);
  });
}

const pipeline = {
  id: "pipe-1",
  name: "Ventes",
  isDefault: true,
  stages: [
    { id: "stage-1", name: "Nouveau", order: 0 },
    { id: "stage-2", name: "Gagné", order: 1 },
  ],
};
const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };

function mockGetByPath(path: string) {
  if (path.startsWith("/pipelines")) return Promise.resolve([pipeline]);
  if (path.startsWith("/contacts")) return Promise.resolve([contact]);
  if (path.startsWith("/custom-fields")) return Promise.resolve([]);
  throw new Error(`unexpected GET ${path}`);
}

describe("LeadsPage (flat table, Phase D1)", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
    mockLeadsPage([]);
  });

  it("renders the toggle button and an empty state when there are no leads", async () => {
    renderWithProviders(<LeadsPage />);
    expect(await screen.findByRole("button", { name: "Nouveau prospect" })).toBeInTheDocument();
    expect(await screen.findByText("Aucun prospect.")).toBeInTheDocument();
  });

  it("toggles the create form open and closed via the same button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    const toggle = await screen.findByRole("button", { name: "Nouveau prospect" });
    expect(screen.queryByPlaceholderText("Source (optionnel)")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByPlaceholderText("Source (optionnel)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByPlaceholderText("Source (optionnel)")).not.toBeInTheDocument();
  });

  it("submits the create form and calls POST /leads with exactly the selected/typed fields", async () => {
    postMock.mockResolvedValue({ id: "lead-1" });
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    await user.click(await screen.findByRole("button", { name: "Nouveau prospect" }));
    await user.selectOptions(screen.getByDisplayValue("Choisir un contact"), "contact-1");
    await user.type(screen.getByPlaceholderText("Source (optionnel)"), "site web");
    await user.click(screen.getByRole("button", { name: "Créer le prospect" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/leads", {
        contactId: "contact-1",
        source: "site web",
        customFields: {},
      }),
    );
  });

  it("shows a loading state on the submit button while the request is pending", async () => {
    postMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    await user.click(await screen.findByRole("button", { name: "Nouveau prospect" }));
    await user.selectOptions(screen.getByDisplayValue("Choisir un contact"), "contact-1");
    await user.click(screen.getByRole("button", { name: "Créer le prospect" }));

    expect(await screen.findByRole("button", { name: "Création..." })).toBeDisabled();
  });

  it("fetches page 1 by default and shows the page count from the response", async () => {
    mockLeadsPage([], { page: 1, limit: 20, total: 45, totalPages: 3 });
    renderWithProviders(<LeadsPage />);

    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/leads?page=1"));
    expect(await screen.findByText("Page 1 sur 3")).toBeInTheDocument();
  });

  it("clicking Suivant fetches the next page", async () => {
    mockLeadsPage([], { page: 1, limit: 20, total: 45, totalPages: 3 });
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    await screen.findByText("Page 1 sur 3");
    mockLeadsPage([], { page: 2, limit: 20, total: 45, totalPages: 3 });
    await user.click(screen.getByRole("button", { name: "Suivant" }));

    await waitFor(() => expect(getListMock).toHaveBeenCalledWith("/leads?page=2"));
    expect(await screen.findByText("Page 2 sur 3")).toBeInTheDocument();
  });
});

describe("LeadsPage — status filter and table (Phase D1)", () => {
  const leadOne = {
    id: "lead-1",
    contactId: "contact-1",
    status: "new",
    source: "site web",
    createdAt: "2026-01-01T00:00:00.000Z",
  };

  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
    mockLeadsPage([leadOne]);
  });

  it("renders the lead row with contact, source and status", async () => {
    renderWithProviders(<LeadsPage />);

    expect(await screen.findByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/dashboard/crm/leads/lead-1",
    );
    expect(screen.getByText("site web")).toBeInTheDocument();
    const row = screen.getByRole("link", { name: "Ada Lovelace" }).closest("tr")!;
    expect(within(row).getByText("Nouveaux")).toBeInTheDocument();
  });

  it("changing the status filter refetches with ?status=", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await screen.findByRole("link", { name: "Ada Lovelace" });

    await user.selectOptions(screen.getByDisplayValue("Tous les statuts"), "qualified");

    await waitFor(() =>
      expect(getListMock).toHaveBeenCalledWith("/leads?page=1&status=qualified"),
    );
  });

  it("clicking Convertir en affaire opens the inline convert form and posts to /leads/:id/convert", async () => {
    postMock.mockResolvedValue({ lead: { ...leadOne, status: "converted" }, deal: { id: "deal-1" } });
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    await user.click(await screen.findByRole("button", { name: "Convertir en affaire" }));
    const form = screen.getByRole("button", { name: "Convertir" }).closest("form")!;
    await user.click(within(form).getByRole("button", { name: "Convertir" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/leads/lead-1/convert",
        expect.objectContaining({ pipelineId: "pipe-1", stageId: "stage-1" }),
      ),
    );
  });

  it("does not show a convert action for an already-converted lead", async () => {
    mockLeadsPage([{ ...leadOne, status: "converted" }]);
    renderWithProviders(<LeadsPage />);

    await screen.findByRole("link", { name: "Ada Lovelace" });
    expect(screen.queryByRole("button", { name: "Convertir en affaire" })).not.toBeInTheDocument();
  });

  it("on convert error: shows a message near the form", async () => {
    postMock.mockRejectedValue(new ApiError("LEAD_ALREADY_CONVERTED", "Déjà converti"));
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    await user.click(await screen.findByRole("button", { name: "Convertir en affaire" }));
    const form = screen.getByRole("button", { name: "Convertir" }).closest("form")!;
    await user.click(within(form).getByRole("button", { name: "Convertir" }));

    expect(await screen.findByText("Déjà converti")).toBeInTheDocument();
  });
});
