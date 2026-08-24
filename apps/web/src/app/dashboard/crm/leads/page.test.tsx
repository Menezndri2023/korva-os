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
    apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  };
});

// This page's queries are gated on auth bootstrap readiness (Bug #6) — these tests exercise
// the page's own behavior once that readiness is established, not the readiness gate itself
// (covered separately in use-auth-ready.test.ts).
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);
const patchMock = vi.mocked(apiClient.patch);

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
  if (path.startsWith("/leads")) return Promise.resolve([]);
  throw new Error(`unexpected GET ${path}`);
}

describe("LeadsPage (migrated to @korva/ui Button/Input/Card in F2-B.8)", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockImplementation(mockGetByPath);
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
      if (path.startsWith("/leads")) return Promise.resolve([]);
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
    postMock.mockReset();
    patchMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path.startsWith("/pipelines")) return Promise.resolve([pipeline]);
      if (path.startsWith("/contacts")) return Promise.resolve([contact, contactTwo]);
      if (path.startsWith("/leads")) return Promise.resolve([leadOne, leadTwo]);
      throw new Error(`unexpected GET ${path}`);
    });
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

    const leadsCallsBefore = getMock.mock.calls.filter(([path]) =>
      (path as string).startsWith("/leads"),
    ).length;

    const statusSelect = await screen.findByLabelText("Statut de Ada Lovelace");
    await user.selectOptions(statusSelect, "won");

    await waitFor(() =>
      expect(
        getMock.mock.calls.filter(([path]) => (path as string).startsWith("/leads")).length,
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
