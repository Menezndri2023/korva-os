import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import OnboardingPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setActiveOrganization: vi.fn() }),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, post: vi.fn(), patch: vi.fn() } };
});

const postMock = vi.mocked(apiClient.post);
const patchMock = vi.mocked(apiClient.patch);

function fillRequiredFields() {
  fireEvent.input(screen.getByLabelText("Nom de l'entreprise"), {
    target: { value: "Audit Org" },
  });
  fireEvent.input(screen.getByLabelText("Secteur d'activité"), {
    target: { value: "audit" },
  });
}

describe("OnboardingPage — module selection (Bug #4)", () => {
  beforeEach(() => {
    postMock.mockReset();
    patchMock.mockReset();
    postMock.mockResolvedValue({ id: "org-1" });
    patchMock.mockResolvedValue({ id: "org-1" });
  });

  it("A — offers Statistiques (analytics) among the selectable modules", () => {
    renderWithProviders(<OnboardingPage />);
    expect(screen.getByText("Statistiques")).toBeInTheDocument();
    // Sanity check: existing modules remain offered alongside it.
    expect(screen.getByText("Clients & Prospects (CRM)")).toBeInTheDocument();
  });

  it("B — Statistiques can be selected via its checkbox", () => {
    renderWithProviders(<OnboardingPage />);
    const checkbox = screen.getByRole("checkbox", { name: "Statistiques" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
  });

  it("C/D — submitting with Statistiques checked persists it: enabledModules sent to the API includes analytics", async () => {
    renderWithProviders(<OnboardingPage />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("checkbox", { name: "Statistiques" }));
    fireEvent.click(screen.getByRole("button", { name: "Créer mon organisation" }));

    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    expect(patchMock).toHaveBeenCalledWith("/organizations/me", {
      enabledModules: expect.arrayContaining(["analytics"]),
    });
  });

  it("G — selecting another module (CRM) alongside Statistiques still persists both, unaffected by the fix", async () => {
    renderWithProviders(<OnboardingPage />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("checkbox", { name: "Statistiques" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Clients & Prospects (CRM)" }));
    fireEvent.click(screen.getByRole("button", { name: "Créer mon organisation" }));

    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    expect(patchMock).toHaveBeenCalledWith("/organizations/me", {
      enabledModules: expect.arrayContaining(["analytics", "crm"]),
    });
  });

  it("not selecting Statistiques omits it from the persisted modules", async () => {
    renderWithProviders(<OnboardingPage />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("checkbox", { name: "Clients & Prospects (CRM)" }));
    fireEvent.click(screen.getByRole("button", { name: "Créer mon organisation" }));

    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    const [, body] = patchMock.mock.calls[0]!;
    expect((body as { enabledModules: string[] }).enabledModules).not.toContain("analytics");
  });
});

describe("OnboardingPage — vertical templates (docs/BUSINESS_OS_AUDIT.md roadmap item #7)", () => {
  beforeEach(() => {
    postMock.mockReset();
    patchMock.mockReset();
    postMock.mockResolvedValue({ id: "org-1" });
    patchMock.mockResolvedValue({ id: "org-1" });
  });

  it("renders a vertical template card and keeps the free-text secteur input fillable as before", () => {
    renderWithProviders(<OnboardingPage />);
    expect(screen.getByText("Salon & bien-être")).toBeInTheDocument();
    expect(screen.getByLabelText("Secteur d'activité")).toBeInTheDocument();
  });

  it("selecting a vertical pre-fills the secteur input and pre-checks its suggested modules", () => {
    renderWithProviders(<OnboardingPage />);
    fireEvent.click(screen.getByText("Restaurant"));

    expect(screen.getByLabelText("Secteur d'activité")).toHaveValue("restauration");
    expect(screen.getByRole("checkbox", { name: "Commandes & E-commerce" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Automatisations" })).toBeChecked();
  });

  it("a pre-filled secteur value from a template can still be edited freely", () => {
    renderWithProviders(<OnboardingPage />);
    fireEvent.click(screen.getByText("Restaurant"));
    fireEvent.input(screen.getByLabelText("Secteur d'activité"), {
      target: { value: "restauration rapide" },
    });
    expect(screen.getByLabelText("Secteur d'activité")).toHaveValue("restauration rapide");
  });

  it("submitting with a vertical selected creates its starter workflow after the organization and modules are set up", async () => {
    renderWithProviders(<OnboardingPage />);
    fireEvent.input(screen.getByLabelText("Nom de l'entreprise"), {
      target: { value: "Le Bon Repas" },
    });
    fireEvent.click(screen.getByText("Restaurant"));
    fireEvent.click(screen.getByRole("button", { name: "Créer mon organisation" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/workflows",
        expect.objectContaining({
          name: "Nouvelle commande",
          trigger: "order.created",
          actions: [
            {
              type: "internal_notification",
              config: {
                title: "Nouvelle commande",
                body: "Commande {{orderId}} à préparer.",
              },
            },
          ],
        }),
      ),
    );

    // Order matters: the workflow can only be created once the organization exists.
    const orgCallIndex = postMock.mock.calls.findIndex((call) => call[0] === "/organizations");
    const workflowCallIndex = postMock.mock.calls.findIndex((call) => call[0] === "/workflows");
    expect(orgCallIndex).toBeGreaterThanOrEqual(0);
    expect(workflowCallIndex).toBeGreaterThan(orgCallIndex);
  });

  it("does not create any starter workflow when no vertical was selected", async () => {
    renderWithProviders(<OnboardingPage />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Créer mon organisation" }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/organizations", expect.anything(), expect.anything()));
    expect(postMock).not.toHaveBeenCalledWith("/workflows", expect.anything());
  });

  it("does not create the starter workflow if the workflow module is unchecked after selecting a vertical", async () => {
    renderWithProviders(<OnboardingPage />);
    fireEvent.input(screen.getByLabelText("Nom de l'entreprise"), {
      target: { value: "Le Bon Repas" },
    });
    fireEvent.click(screen.getByText("Restaurant"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Automatisations" })); // uncheck
    fireEvent.click(screen.getByRole("button", { name: "Créer mon organisation" }));

    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    expect(postMock).not.toHaveBeenCalledWith("/workflows", expect.anything());
  });
});

describe("OnboardingPage — importer mon entreprise", () => {
  beforeEach(() => {
    postMock.mockReset();
    patchMock.mockReset();
    patchMock.mockResolvedValue({ id: "org-1" });
  });

  it("pre-fills the name field and shows a confirmation once import-preview resolves", async () => {
    postMock.mockImplementation((path) =>
      path === "/organizations/import-preview"
        ? Promise.resolve({ name: "Acme Corp", tagline: "We sell widgets", logo: "https://acme.example.com/logo.png" })
        : Promise.resolve({ id: "org-1" }),
    );
    renderWithProviders(<OnboardingPage />);

    fireEvent.input(screen.getByPlaceholderText("https://mon-entreprise.com"), {
      target: { value: "https://acme.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyser" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Nom de l'entreprise")).toHaveValue("Acme Corp"),
    );
    expect(
      screen.getByText("Informations importées — vérifiez-les ci-dessous avant de continuer."),
    ).toBeInTheDocument();
  });

  it("submitting after a successful import also patches the imported tagline/logo", async () => {
    postMock.mockImplementation((path) =>
      path === "/organizations/import-preview"
        ? Promise.resolve({ name: "Acme Corp", tagline: "We sell widgets", logo: "https://acme.example.com/logo.png" })
        : Promise.resolve({ id: "org-1" }),
    );
    renderWithProviders(<OnboardingPage />);

    fireEvent.input(screen.getByPlaceholderText("https://mon-entreprise.com"), {
      target: { value: "https://acme.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyser" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Nom de l'entreprise")).toHaveValue("Acme Corp"),
    );

    fireEvent.input(screen.getByLabelText("Secteur d'activité"), { target: { value: "commerce" } });
    fireEvent.click(screen.getByRole("button", { name: "Créer mon organisation" }));

    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    const [, body] = patchMock.mock.calls[0]!;
    expect(body).toMatchObject({
      tagline: "We sell widgets",
      logo: "https://acme.example.com/logo.png",
    });
  });

  it("shows an error and never touches the form when import-preview fails", async () => {
    const { ApiError } = await import("@/lib/api-client");
    postMock.mockImplementation((path) =>
      path === "/organizations/import-preview"
        ? Promise.reject(new ApiError("IMPORT_URL_UNREACHABLE", "Unable to reach this URL"))
        : Promise.resolve({ id: "org-1" }),
    );
    renderWithProviders(<OnboardingPage />);

    fireEvent.input(screen.getByPlaceholderText("https://mon-entreprise.com"), {
      target: { value: "https://unreachable.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Analyser" }));

    await waitFor(() => expect(screen.getByText("Unable to reach this URL")).toBeInTheDocument());
    expect(screen.getByLabelText("Nom de l'entreprise")).toHaveValue("");
  });
});

describe("OnboardingPage — timezone field (WAVE 2 AGENT E)", () => {
  beforeEach(() => {
    postMock.mockReset();
    patchMock.mockReset();
    postMock.mockResolvedValue({ id: "org-1" });
    patchMock.mockResolvedValue({ id: "org-1" });
  });

  it("pre-selects the browser's own resolved timezone", () => {
    renderWithProviders(<OnboardingPage />);
    const select = screen.getByLabelText("Fuseau horaire") as HTMLSelectElement;
    expect(select).toHaveValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("lists real IANA timezone identifiers as options, not a hardcoded stand-in list", () => {
    renderWithProviders(<OnboardingPage />);
    const select = screen.getByLabelText("Fuseau horaire") as HTMLSelectElement;
    const values = Array.from(select.querySelectorAll("option")).map((option) => option.value);
    expect(values.length).toBe(Intl.supportedValuesOf("timeZone").length);
    expect(values).toContain("Europe/Paris");
  });

  it("submitting a changed timezone sends it in the POST /organizations payload", async () => {
    renderWithProviders(<OnboardingPage />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("Fuseau horaire"), {
      target: { value: "Europe/Paris" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer mon organisation" }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    const [, body] = postMock.mock.calls[0]!;
    expect((body as { timezone: string }).timezone).toBe("Europe/Paris");
  });
});
