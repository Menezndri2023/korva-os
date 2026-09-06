import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DealsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

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

function mockDealsPage(
  deals: unknown[],
  pagination = { page: 1, limit: 20, total: deals.length, totalPages: 1 },
) {
  getListMock.mockImplementation((path: string) => {
    if (path.startsWith("/deals")) return Promise.resolve({ data: deals, pagination });
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

describe("DealsPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
    mockDealsPage([]);
  });

  it("shows the empty-state Card + Button and seeds a default pipeline on click when none exists", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/pipelines")) return Promise.resolve([]);
      if (path.startsWith("/contacts")) return Promise.resolve([contact]);
      throw new Error(`unexpected GET ${path}`);
    });
    postMock.mockResolvedValue(pipeline);
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);

    const seedButton = await screen.findByRole("button", { name: "Créer un pipeline par défaut" });
    await user.click(seedButton);

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/pipelines",
        expect.objectContaining({ name: "Ventes", isDefault: true }),
      ),
    );
  });

  it("submits the create form and calls POST /deals with exactly the selected/typed fields", async () => {
    postMock.mockResolvedValue({ id: "deal-1" });
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);

    await user.click(await screen.findByRole("button", { name: "Nouvelle affaire" }));
    await user.selectOptions(screen.getByDisplayValue("Choisir un contact"), "contact-1");
    await user.selectOptions(screen.getByDisplayValue("Nouveau"), "stage-2");
    await user.type(screen.getByPlaceholderText("Valeur estimée"), "42");
    await user.click(screen.getByRole("button", { name: "Créer l'affaire" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/deals", {
        contactId: "contact-1",
        pipelineId: "pipe-1",
        stageId: "stage-2",
        estimatedValue: 42,
        customFields: {},
      }),
    );
  });
});

describe("DealsPage — kanban board", () => {
  const dealOne = {
    id: "deal-1",
    contactId: "contact-1",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    status: "open",
    estimatedValue: 100,
  };

  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
    mockDealsPage([dealOne]);
  });

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

  it("renders one column per pipeline stage, with the deal placed under its own stage", async () => {
    renderWithProviders(<DealsPage />);

    expect(await screen.findByRole("heading", { name: /^Nouveau/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Gagné/ })).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
  });

  it("dragging a card onto a different stage column persists via POST /deals/:id/move-stage", async () => {
    postMock.mockResolvedValue({ ...dealOne, stageId: "stage-2" });
    renderWithProviders(<DealsPage />);

    const card = (await screen.findByText("Ada Lovelace")).closest("[draggable]") as HTMLElement;
    const targetColumn = screen
      .getByRole("heading", { name: /^Gagné/ })
      .closest("div") as HTMLElement;

    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(targetColumn, { dataTransfer });

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/deals/deal-1/move-stage", { stageId: "stage-2" }),
    );
  });

  it("clicking Gagner calls POST /deals/:id/win", async () => {
    postMock.mockResolvedValue({ ...dealOne, status: "won" });
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);

    await user.click(await screen.findByRole("button", { name: "Gagner" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/deals/deal-1/win"));
  });

  it("a won deal shows a Rouvrir button instead of stage/win/lose controls", async () => {
    mockDealsPage([{ ...dealOne, status: "won" }]);
    renderWithProviders(<DealsPage />);

    expect(await screen.findByRole("button", { name: "Rouvrir" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gagner" })).not.toBeInTheDocument();
  });
});

describe("DealsPage — multiple pipelines", () => {
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
  const salesDeal = {
    id: "deal-1",
    contactId: "contact-1",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    status: "open",
    estimatedValue: 100,
  };

  beforeEach(() => {
    getMock.mockReset();
    getListMock.mockReset();
    postMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/pipelines")) {
        return Promise.resolve([salesPipeline, supportPipeline]);
      }
      if (path.startsWith("/contacts")) return Promise.resolve([contact]);
      throw new Error(`unexpected GET ${path}`);
    });
    mockDealsPage([salesDeal]);
  });

  it("shows a pipeline picker only when more than one pipeline exists, defaulting to the default pipeline's board", async () => {
    renderWithProviders(<DealsPage />);

    expect(await screen.findByText("Pipeline")).toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: "Pipeline" });
    expect(picker).toHaveValue("pipe-1");
    expect(screen.getByRole("heading", { name: /^Nouveau/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Ouvert/ })).not.toBeInTheDocument();
  });

  it("switching the picker swaps the board to the other pipeline's stages/deals", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DealsPage />);
    await screen.findByRole("heading", { name: /^Nouveau/ });

    await user.selectOptions(screen.getByRole("combobox", { name: "Pipeline" }), "pipe-2");

    expect(await screen.findByRole("heading", { name: /^Ouvert/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^Résolu/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^Nouveau/ })).not.toBeInTheDocument();
  });
});
