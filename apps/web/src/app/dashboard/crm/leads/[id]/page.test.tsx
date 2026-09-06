import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LeadDetailPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "lead-1" }),
  useRouter: () => ({ push: pushMock }),
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
  status: "new" as const,
  source: "site web",
  customFields: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

function mockGetByPath(path: string) {
  if (path === "/leads/lead-1") return Promise.resolve(lead);
  if (path === "/leads/lead-1/score") return Promise.resolve({ score: 45, factors: {} });
  if (path.startsWith("/contacts")) return Promise.resolve([contact]);
  if (path.startsWith("/pipelines")) return Promise.resolve([pipeline]);
  if (path.startsWith("/deals")) return Promise.resolve([]);
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
    pushMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
  });

  it("shows the contact link and source", async () => {
    renderWithProviders(<LeadDetailPage />);

    expect(await screen.findByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
      "href",
      "/dashboard/crm/contact-1",
    );
    expect(screen.getAllByText("site web").length).toBeGreaterThan(0);
  });

  it("shows the real LEAD_STATUSES as select options", async () => {
    renderWithProviders(<LeadDetailPage />);

    const statusSelect = await screen.findByLabelText("Statut");
    expect(statusSelect).toHaveValue("new");
    expect(within(statusSelect).getByText("Nouveaux")).toBeInTheDocument();
    expect(within(statusSelect).getByText("Contactés")).toBeInTheDocument();
    expect(within(statusSelect).getByText("Qualifiés")).toBeInTheDocument();
    expect(within(statusSelect).getByText("Disqualifiés")).toBeInTheDocument();
    expect(within(statusSelect).getByText("Convertis")).toBeInTheDocument();
  });

  it("changing the status sends PATCH /leads/:id with only { status }", async () => {
    patchMock.mockResolvedValue(lead);
    const user = userEvent.setup();
    renderWithProviders(<LeadDetailPage />);

    const statusSelect = await screen.findByLabelText("Statut");
    await user.selectOptions(statusSelect, "qualified");

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/leads/lead-1", { status: "qualified" }),
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

  it("shows a convert button that reveals a pipeline/stage form and posts to /leads/:id/convert", async () => {
    postMock.mockResolvedValue({ lead: { ...lead, status: "converted" }, deal: { id: "deal-1" } });
    const user = userEvent.setup();
    renderWithProviders(<LeadDetailPage />);

    await user.click(await screen.findByRole("button", { name: "Convertir en affaire" }));
    await user.click(screen.getByRole("button", { name: "Convertir" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/leads/lead-1/convert",
        expect.objectContaining({ pipelineId: "pipe-1", stageId: "stage-1" }),
      ),
    );
    expect(pushMock).toHaveBeenCalledWith("/dashboard/crm/deals/deal-1");
  });

  it("hides the convert button once the lead is already converted", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/leads/lead-1") return Promise.resolve({ ...lead, status: "converted" });
      return mockGetByPath(path);
    });
    renderWithProviders(<LeadDetailPage />);

    await screen.findByLabelText("Statut");
    expect(screen.queryByRole("button", { name: "Convertir en affaire" })).not.toBeInTheDocument();
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
