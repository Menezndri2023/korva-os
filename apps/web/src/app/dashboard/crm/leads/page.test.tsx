import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LeadsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() } };
});

// This page's queries are gated on auth bootstrap readiness (Bug #6) — these tests exercise
// the page's own behavior once that readiness is established, not the readiness gate itself
// (covered separately in use-auth-ready.test.ts).
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

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
