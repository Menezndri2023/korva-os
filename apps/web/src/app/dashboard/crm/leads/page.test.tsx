import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

// This page's queries are gated on auth bootstrap readiness (Bug #6) — these tests exercise
// the page's own behavior once that readiness is established, not the readiness gate itself
// (covered separately in use-auth-ready.test.ts).
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const getListMock = vi.mocked(apiClient.getList);
const postMock = vi.mocked(apiClient.post);
const patchMock = vi.mocked(apiClient.patch);

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
  throw new Error(`unexpected GET ${path}`);
}

describe("LeadsPage (migrated to @korva/ui Button/Input/Card in F2-B.8)", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
    mockLeadsPage([]);
  });

  it("renders the toggle button and the table wrapper when a pipeline already exists", async () => {
    renderWithProviders(<LeadsPage />);
    expect(await screen.findByRole("button", { name: "Nouveau prospect" })).toBeInTheDocument();
    expect(await screen.findByText("Aucun prospect.")).toBeInTheDocument();
  });

  it("shows the empty-state Card + Button and seeds a default pipeline on click", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/pipelines")) return Promise.resolve([]);
      if (path.startsWith("/contacts")) return Promise.resolve([contact]);
      throw new Error(`unexpected GET ${path}`);
    });
    postMock.mockResolvedValue(pipeline);
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    const seedButton = await screen.findByRole("button", { name: "Créer un pipeline par défaut" });
    await user.click(seedButton);

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/pipelines",
        expect.objectContaining({ name: "Ventes", isDefault: true }),
      ),
    );
  });

  it("toggles the create form open and closed via the same button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    const toggle = await screen.findByRole("button", { name: "Nouveau prospect" });
    expect(screen.queryByPlaceholderText("Valeur estimée")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByPlaceholderText("Valeur estimée")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByPlaceholderText("Valeur estimée")).not.toBeInTheDocument();
  });

  it("submits the create form and calls POST /leads with exactly the selected/typed fields", async () => {
    postMock.mockResolvedValue({ id: "lead-1" });
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    await user.click(await screen.findByRole("button", { name: "Nouveau prospect" }));
    await user.selectOptions(screen.getByDisplayValue("Choisir un contact"), "contact-1");
    await user.selectOptions(screen.getByDisplayValue("Nouveau"), "stage-2");
    await user.type(screen.getByPlaceholderText("Valeur estimée"), "42");
    await user.click(screen.getByRole("button", { name: "Créer le prospect" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/leads", {
        contactId: "contact-1",
        pipelineId: "pipe-1",
        stageId: "stage-2",
        estimatedValue: 42,
      }),
    );
  });

  it("shows a loading state on the submit button while the request is pending", async () => {
    postMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    await user.click(await screen.findByRole("button", { name: "Nouveau prospect" }));
    await user.selectOptions(screen.getByDisplayValue("Choisir un contact"), "contact-1");
    await user.type(screen.getByPlaceholderText("Valeur estimée"), "42");
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

describe("LeadsPage — update lead status/stage (LOT F3)", () => {
  const leadOne = {
    id: "lead-1",
    contactId: "contact-1",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    status: "open",
    estimatedValue: 100,
  };
  const leadTwo = {
    id: "lead-2",
    contactId: "contact-2",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    status: "open",
    estimatedValue: 200,
  };
  const contactTwo = { id: "contact-2", firstName: "Grace", lastName: "Hopper", tags: [] };

  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/pipelines")) return Promise.resolve([pipeline]);
      if (path.startsWith("/contacts")) return Promise.resolve([contact, contactTwo]);
      throw new Error(`unexpected GET ${path}`);
    });
    mockLeadsPage([leadOne, leadTwo]);
  });

  it("shows the lead's current status", async () => {
    renderWithProviders(<LeadsPage />);
    expect(await screen.findByLabelText("Statut de Ada Lovelace")).toHaveValue("open");
  });

  it("lists the real LEAD_STATUSES values as options", async () => {
    renderWithProviders(<LeadsPage />);
    const statusSelect = await screen.findByLabelText("Statut de Ada Lovelace");
    expect(within(statusSelect).getByText("Ouverts")).toBeInTheDocument();
    expect(within(statusSelect).getByText("Gagnés")).toBeInTheDocument();
    expect(within(statusSelect).getByText("Perdus")).toBeInTheDocument();
    // Only within this one select — 3 options, no others invented.
    expect(statusSelect.querySelectorAll("option")).toHaveLength(3);
  });

  it("changing the status sends PATCH /leads/:id with only { status }", async () => {
    patchMock.mockResolvedValue(leadOne);
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    const statusSelect = await screen.findByLabelText("Statut de Ada Lovelace");
    await user.selectOptions(statusSelect, "won");

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/leads/lead-1", { status: "won" }),
    );
  });

  it("shows the lead's current stage", async () => {
    renderWithProviders(<LeadsPage />);
    expect(await screen.findByLabelText("Étape de Ada Lovelace")).toHaveValue("stage-1");
  });

  it("lists the real pipeline stages as options", async () => {
    renderWithProviders(<LeadsPage />);
    const stageSelect = await screen.findByLabelText("Étape de Ada Lovelace");
    expect(within(stageSelect).getByText("Nouveau")).toBeInTheDocument();
    expect(within(stageSelect).getByText("Gagné")).toBeInTheDocument();
    expect(stageSelect.querySelectorAll("option")).toHaveLength(2);
  });

  it("changing the stage sends PATCH /leads/:id with only { stageId }", async () => {
    patchMock.mockResolvedValue(leadOne);
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    const stageSelect = await screen.findByLabelText("Étape de Ada Lovelace");
    await user.selectOptions(stageSelect, "stage-2");

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/leads/lead-1", { stageId: "stage-2" }),
    );
  });

  it("disables only the row being updated while its mutation is pending", async () => {
    patchMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    const statusSelectOne = await screen.findByLabelText("Statut de Ada Lovelace");
    const statusSelectTwo = await screen.findByLabelText("Statut de Grace Hopper");
    await user.selectOptions(statusSelectOne, "won");

    await waitFor(() => expect(statusSelectOne).toBeDisabled());
    expect(statusSelectTwo).not.toBeDisabled();
  });

  it("on success: refetches the leads list", async () => {
    patchMock.mockResolvedValue(leadOne);
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    const leadsCallsBefore = getListMock.mock.calls.filter(([path]) =>
      (path as string).startsWith("/leads"),
    ).length;

    const statusSelect = await screen.findByLabelText("Statut de Ada Lovelace");
    await user.selectOptions(statusSelect, "won");

    await waitFor(() =>
      expect(
        getListMock.mock.calls.filter(([path]) => (path as string).startsWith("/leads")).length,
      ).toBeGreaterThan(leadsCallsBefore),
    );
  });

  it("on API error: shows a message near the affected row", async () => {
    patchMock.mockRejectedValue(new ApiError("VALIDATION_ERROR", "Étape invalide pour ce pipeline"));
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    const stageSelect = await screen.findByLabelText("Étape de Ada Lovelace");
    await user.selectOptions(stageSelect, "stage-2");

    expect(await screen.findByText("Étape invalide pour ce pipeline")).toBeInTheDocument();
  });

  it("on a 403 PERMISSION_DENIED error: shows the message and keeps the server value", async () => {
    patchMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "Réservé aux administrateurs"));
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);

    const statusSelect = await screen.findByLabelText("Statut de Ada Lovelace");
    await user.selectOptions(statusSelect, "won");

    expect(await screen.findByText("Réservé aux administrateurs")).toBeInTheDocument();
    // No invalidation on error — the select still reflects the untouched server value.
    expect(screen.getByLabelText("Statut de Ada Lovelace")).toHaveValue("open");
  });
});

describe("LeadsPage — kanban board (WAVE 2 AGENT E)", () => {
  const leadOne = {
    id: "lead-1",
    contactId: "contact-1",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    status: "open",
    estimatedValue: 100,
  };
  const contactTwo = { id: "contact-2", firstName: "Grace", lastName: "Hopper", tags: [] };

  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/pipelines")) return Promise.resolve([pipeline]);
      if (path.startsWith("/contacts")) return Promise.resolve([contact, contactTwo]);
      throw new Error(`unexpected GET ${path}`);
    });
    mockLeadsPage([leadOne]);
  });

  // jsdom has no native DataTransfer; this minimal stand-in implements just the get/setData
  // pair the drag handlers actually call, shared between the dragstart and drop fireEvent calls
  // exactly like the real browser object is shared across a single drag gesture.
  function createDataTransfer() {
    const store: Record<string, string> = {};
    return {
      setData: (format: string, data: string) => {
        store[format] = data;
      },
      getData: (format: string) => store[format] ?? "",
      dropEffect: "move",
      effectAllowed: "move",
    };
  }

  it("renders one column per pipeline stage, with the lead placed under its own stage", async () => {
    renderWithProviders(<LeadsPage />);

    // The column heading's accessible name is "<stage name> <card count>" (two <span>s inside
    // one <h3>) — asserting on it also proves the lead was placed in the right column, since
    // "Nouveau" holds 1 card and "Gagné" holds 0.
    expect(await screen.findByRole("heading", { name: /^Nouveau/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Gagné/ })).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("dragging a card onto a different stage column persists via PATCH /leads/:id with only { stageId }", async () => {
    patchMock.mockResolvedValue({ ...leadOne, stageId: "stage-2" });
    renderWithProviders(<LeadsPage />);

    const card = (await screen.findByText("Ada Lovelace")).closest("[draggable]") as HTMLElement;
    const targetColumn = screen
      .getByRole("heading", { name: /^Gagné/ })
      .closest("div") as HTMLElement;
    expect(card).not.toBeNull();
    expect(targetColumn).not.toBeNull();

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(targetColumn, { dataTransfer });

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/leads/lead-1", { stageId: "stage-2" }),
    );
  });

  it("dropping a card back onto its own column sends no PATCH", async () => {
    renderWithProviders(<LeadsPage />);

    const card = (await screen.findByText("Ada Lovelace")).closest("[draggable]") as HTMLElement;
    const sameColumn = screen
      .getByRole("heading", { name: /^Nouveau/ })
      .closest("div") as HTMLElement;

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(sameColumn, { dataTransfer });

    expect(patchMock).not.toHaveBeenCalled();
  });
});

describe("LeadsPage — multiple pipelines", () => {
  const salesPipeline = pipeline;
  const supportPipeline = {
    id: "pipe-2",
    name: "Support",
    isDefault: false,
    stages: [
      { id: "stage-3", name: "Ouvert", order: 0 },
      { id: "stage-4", name: "Résolu", order: 1 },
    ],
  };
  const salesLead = {
    id: "lead-1",
    contactId: "contact-1",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    status: "open",
    estimatedValue: 100,
  };
  const supportLead = {
    id: "lead-2",
    contactId: "contact-1",
    pipelineId: "pipe-2",
    stageId: "stage-3",
    status: "open",
    estimatedValue: 50,
  };

  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/pipelines")) {
        return Promise.resolve([salesPipeline, supportPipeline]);
      }
      if (path.startsWith("/contacts")) return Promise.resolve([contact]);
      throw new Error(`unexpected GET ${path}`);
    });
    mockLeadsPage([salesLead, supportLead]);
  });

  it("shows a pipeline picker only when more than one pipeline exists, defaulting to the default pipeline's board", async () => {
    renderWithProviders(<LeadsPage />);

    expect(await screen.findByText("Pipeline")).toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: "Pipeline" });
    expect(picker).toHaveValue("pipe-1");
    // Sales board showing: its own lead's column is visible, the support pipeline's stage
    // names are not (they only exist as columns once Support is selected).
    expect(screen.getByRole("heading", { name: /^Nouveau/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Ouvert/ })).not.toBeInTheDocument();
  });

  it("switching the picker swaps the board to the other pipeline's stages/leads", async () => {
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await screen.findByRole("heading", { name: /^Nouveau/ });

    await user.selectOptions(screen.getByRole("combobox", { name: "Pipeline" }), "pipe-2");

    expect(await screen.findByRole("heading", { name: /^Ouvert/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Résolu/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Nouveau/ })).not.toBeInTheDocument();
  });

  it("creating a lead while Support is selected submits that pipeline's id, not the default", async () => {
    postMock.mockResolvedValue(supportLead);
    const user = userEvent.setup();
    renderWithProviders(<LeadsPage />);
    await screen.findByRole("heading", { name: /^Nouveau/ });

    await user.selectOptions(screen.getByRole("combobox", { name: "Pipeline" }), "pipe-2");
    await screen.findByRole("heading", { name: /^Ouvert/ });

    await user.click(screen.getByRole("button", { name: "Nouveau prospect" }));
    await user.selectOptions(screen.getByDisplayValue("Choisir un contact"), "contact-1");
    await user.click(screen.getByRole("button", { name: "Créer le prospect" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/leads",
        expect.objectContaining({ pipelineId: "pipe-2" }),
      ),
    );
  });
});
