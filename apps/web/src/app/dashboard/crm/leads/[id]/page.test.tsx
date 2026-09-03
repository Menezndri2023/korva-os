import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LeadDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "lead-1" }),
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
    },
  };
});

vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);
const patchMock = vi.mocked(apiClient.patch);

const contact = { id: "contact-1", firstName: "Ada", lastName: "Lovelace", tags: [] };
const pipeline = {
  id: "pipe-1",
  name: "Ventes",
  isDefault: true,
  stages: [
    { id: "stage-1", name: "Nouveau", order: 0 },
    { id: "stage-2", name: "Gagné", order: 1 },
  ],
};

const lead = {
  id: "lead-1",
  contactId: "contact-1",
  pipelineId: "pipe-1",
  stageId: "stage-1",
  status: "open" as const,
  source: "site web",
  estimatedValue: 500,
  probability: 40,
  customFields: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

function mockGetByPath(path: string) {
  if (path === "/leads/lead-1") return Promise.resolve(lead);
  if (path.startsWith("/contacts")) return Promise.resolve([contact]);
  if (path.startsWith("/pipelines")) return Promise.resolve([pipeline]);
  if (path.startsWith("/notes")) return Promise.resolve([]);
  if (path.startsWith("/tasks")) return Promise.resolve([]);
  if (path.startsWith("/activities")) return Promise.resolve([]);
  if (path.startsWith("/custom-fields")) return Promise.resolve([]);
  throw new Error(`unexpected GET ${path}`);
}

describe("LeadDetailPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
  });

  it("shows the contact link, pipeline name, source, estimated value and probability", async () => {
    renderWithProviders(<LeadDetailPage />);

    expect(await screen.findByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/dashboard/crm/contact-1",
    );
    expect(screen.getByText("Ventes")).toBeInTheDocument();
    expect(screen.getByText("site web")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("shows the real pipeline stages and LEAD_STATUSES as select options", async () => {
    renderWithProviders(<LeadDetailPage />);

    const stageSelect = await screen.findByLabelText("Étape");
    expect(stageSelect).toHaveValue("stage-1");
    expect(within(stageSelect).getByText("Nouveau")).toBeInTheDocument();
    expect(within(stageSelect).getByText("Gagné")).toBeInTheDocument();

    const statusSelect = screen.getByLabelText("Statut");
    expect(statusSelect).toHaveValue("open");
  });

  it("changing the status sends PATCH /leads/:id with only { status }", async () => {
    patchMock.mockResolvedValue(lead);
    const user = userEvent.setup();
    renderWithProviders(<LeadDetailPage />);

    const statusSelect = await screen.findByLabelText("Statut");
    await user.selectOptions(statusSelect, "won");

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith("/leads/lead-1", { status: "won" }));
  });

  it("changing the stage sends PATCH /leads/:id with only { stageId }", async () => {
    patchMock.mockResolvedValue(lead);
    const user = userEvent.setup();
    renderWithProviders(<LeadDetailPage />);

    const stageSelect = await screen.findByLabelText("Étape");
    await user.selectOptions(stageSelect, "stage-2");

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/leads/lead-1", { stageId: "stage-2" }),
    );
  });

  it("shows a message and a link back when the lead does not exist", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/leads/lead-1") {
        return Promise.reject(new ApiError("LEAD_NOT_FOUND", "Lead not found"));
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<LeadDetailPage />);

    expect(await screen.findByText("Lead not found")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Retour aux prospects" })).toHaveAttribute(
      "href",
      "/dashboard/crm/leads",
    );
  });

  it("renders custom field entries when present", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/leads/lead-1") {
        return Promise.resolve({ ...lead, customFields: { budget: "10k" } });
      }
      if (path === "/custom-fields?entity=leads") {
        return Promise.resolve([
          { id: "field-1", entity: "leads", key: "budget", label: "Budget", type: "text", required: false },
        ]);
      }
      return mockGetByPath(path);
    });
    renderWithProviders(<LeadDetailPage />);

    expect(await screen.findByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("10k")).toBeInTheDocument();
  });

  it("adds a note scoped to this lead via POST /notes with entity: lead", async () => {
    postMock.mockResolvedValue({ id: "note-1" });
    const user = userEvent.setup();
    renderWithProviders(<LeadDetailPage />);
    await screen.findByLabelText("Statut");

    await user.type(screen.getByLabelText("Contenu de la note"), "Relancer");
    const form = screen.getByLabelText("Contenu de la note").closest("form")!;
    await user.click(within(form).getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/notes", {
        entity: "lead",
        entityId: "lead-1",
        content: "Relancer",
      }),
    );
  });

  it("adds a task scoped to this lead via POST /tasks with entity: lead", async () => {
    postMock.mockResolvedValue({ id: "task-1" });
    const user = userEvent.setup();
    renderWithProviders(<LeadDetailPage />);
    await screen.findByLabelText("Statut");

    await user.type(screen.getByLabelText("Titre de la tâche"), "Envoyer le devis");
    const form = screen.getByLabelText("Titre de la tâche").closest("form")!;
    await user.click(within(form).getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/tasks", {
        entity: "lead",
        entityId: "lead-1",
        title: "Envoyer le devis",
      }),
    );
  });

  it("marks a pending task as done via PATCH /tasks/:id", async () => {
    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/tasks")) {
        return Promise.resolve([
          { id: "task-1", title: "Envoyer le devis", status: "pending", createdAt: "", updatedAt: "" },
        ]);
      }
      return mockGetByPath(path);
    });
    patchMock.mockResolvedValue({ id: "task-1", status: "done" });
    const user = userEvent.setup();
    renderWithProviders(<LeadDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Terminer" }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith("/tasks/task-1", { status: "done" }));
  });

  it("adds an activity scoped to this lead via POST /activities with entity: lead", async () => {
    postMock.mockResolvedValue({ id: "activity-1" });
    const user = userEvent.setup();
    renderWithProviders(<LeadDetailPage />);
    await screen.findByLabelText("Statut");

    await user.selectOptions(screen.getByLabelText("Type d'activité"), "call");
    const form = screen.getByLabelText("Type d'activité").closest("form")!;
    await user.click(within(form).getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/activities", {
        entity: "lead",
        entityId: "lead-1",
        type: "call",
        content: "",
      }),
    );
  });
});
