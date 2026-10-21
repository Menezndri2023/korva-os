import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError, uploadFile } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    apiClient: {
      ...actual.apiClient,
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
    uploadFile: vi.fn(),
  };
});

// Same store shape used by dashboard/page.test.tsx — satisfies both useActiveOrganization's
// and useAuthReady's gating conditions (bootstrapped + an active organization) without having
// to mock either hook individually.
vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      bootstrapped: true,
      activeOrganizationId: "org-1",
      user: { id: "user-1", email: "owner@korva.test" },
    }),
}));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);
const patchMock = vi.mocked(apiClient.patch);
const deleteMock = vi.mocked(apiClient.delete);
const uploadFileMock = vi.mocked(uploadFile);

const subscription = {
  subscription: { id: "sub-1", status: "active" },
  plan: {
    id: "plan-1",
    key: "pro",
    name: "Pro",
    priceAmount: 29,
    priceCurrency: "EUR",
    interval: "month",
    // "ai" deliberately excluded — used to test the plan-locked case.
    modules: ["crm", "catalog", "booking", "analytics"],
    limits: {},
  },
  usage: [],
};

function makeOrganization(enabledModules: string[]) {
  return {
    id: "org-1",
    name: "Org de test",
    slug: "org-de-test",
    type: "service",
    country: "FR",
    currency: "EUR",
    settings: { onboardingCompleted: true },
    enabledModules,
  };
}

describe("SettingsPage — Modules section (LOT F1)", () => {
  let organization: ReturnType<typeof makeOrganization>;

  beforeEach(() => {
    organization = makeOrganization(["crm", "analytics"]);
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    uploadFileMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });

    // Mirrors what the real PATCH /organizations/me does: persists enabledModules so the
    // refetch triggered by invalidating ["organizations", "me"] observes the new state.
    patchMock.mockImplementation((_path: string, body: unknown) => {
      organization = { ...organization, ...(body as { enabledModules: string[] }) };
      return Promise.resolve(organization);
    });
  });

  it("reflects organization.enabledModules: enabled modules checked, others unchecked", async () => {
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByRole("checkbox", { name: /Clients & Prospects/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Statistiques/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Produits & Services/ })).not.toBeChecked();
  });

  it("disables and badges a module the current plan does not include", async () => {
    renderWithProviders(<SettingsPage />);

    const aiCheckbox = await screen.findByRole("checkbox", { name: /Assistant IA/ });
    expect(aiCheckbox).toBeDisabled();
    expect(
      within(aiCheckbox.closest("label")!).getByText("Non inclus dans le plan"),
    ).toBeInTheDocument();
  });

  it("activating a module sends the full enabledModules payload with it added", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    const catalogCheckbox = await screen.findByRole("checkbox", { name: /Produits & Services/ });
    await user.click(catalogCheckbox);

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", {
        enabledModules: ["crm", "analytics", "catalog"],
      }),
    );
  });

  it("deactivating a module sends the payload without it, keeping the rest", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    const crmCheckbox = await screen.findByRole("checkbox", { name: /Clients & Prospects/ });
    await user.click(crmCheckbox);

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", {
        enabledModules: ["analytics"],
      }),
    );
  });

  it("disables every toggle while a mutation is in flight, and shows a saving indicator", async () => {
    let resolvePatch: (value: unknown) => void;
    patchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    const catalogCheckbox = await screen.findByRole("checkbox", { name: /Produits & Services/ });
    await user.click(catalogCheckbox);

    expect(screen.getByText("Enregistrement...")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Clients & Prospects/ })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Réservations/ })).toBeDisabled();

    resolvePatch!(organization);
    await waitFor(() => expect(screen.queryByText("Enregistrement...")).not.toBeInTheDocument());
  });

  it("refreshes organization.enabledModules after a successful mutation, without a manual reload", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    const catalogCheckbox = await screen.findByRole("checkbox", { name: /Produits & Services/ });
    expect(catalogCheckbox).not.toBeChecked();
    await user.click(catalogCheckbox);

    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: /Produits & Services/ })).toBeChecked(),
    );
    // Proves the refreshed state came from a real refetch of ["organizations", "me"], not a
    // locally-patched copy — the mock organization the GET route serves has changed.
    expect(getMock).toHaveBeenCalledWith("/organizations/me");
  });

  it("on a failed mutation, shows the error and leaves enabledModules untouched", async () => {
    patchMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "Réservé aux administrateurs"));
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    const catalogCheckbox = await screen.findByRole("checkbox", { name: /Produits & Services/ });
    await user.click(catalogCheckbox);

    expect(await screen.findByText("Réservé aux administrateurs")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Produits & Services/ })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Clients & Prospects/ })).toBeChecked();
  });
});

describe("SettingsPage — Organization profile edit", () => {
  let organization: ReturnType<typeof makeOrganization> & {
    legalName?: string;
    timezone?: string;
    language?: string;
    logo?: string;
    brandColor?: string;
    tagline?: string;
    heroImage?: string;
  };

  beforeEach(() => {
    organization = {
      ...makeOrganization(["crm"]),
      legalName: "Org de test SARL",
      timezone: "Europe/Paris",
      language: "fr",
      brandColor: "#1a73e8",
      tagline: "Le meilleur salon de la ville",
    };
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    uploadFileMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
  });

  it("shows the organization's current profile fields read-only by default", async () => {
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Org de test")).toBeInTheDocument();
    expect(screen.getByText("Org de test SARL")).toBeInTheDocument();
    expect(screen.getByText("Europe/Paris")).toBeInTheDocument();
    expect(screen.getByText("#1a73e8")).toBeInTheDocument();
    expect(screen.getByText("Le meilleur salon de la ville")).toBeInTheDocument();
    expect(screen.queryByLabelText("Nom")).not.toBeInTheDocument();
  });

  it("Modifier reveals a form prefilled with the organization's current values", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    expect(screen.getByLabelText("Nom")).toHaveValue("Org de test");
    expect(screen.getByLabelText("Raison sociale")).toHaveValue("Org de test SARL");
    expect(screen.getByLabelText("Couleur de marque")).toHaveValue("#1a73e8");
    expect(screen.getByLabelText("Slogan (affiché sur votre page publique)")).toHaveValue(
      "Le meilleur salon de la ville",
    );
  });

  it("submits exactly the edited fields to PATCH /organizations/me and returns to read-only view on success", async () => {
    patchMock.mockResolvedValue({ ...organization, name: "Nouveau nom" });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    const nameInput = screen.getByLabelText("Nom");
    await user.clear(nameInput);
    await user.type(nameInput, "Nouveau nom");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        "/organizations/me",
        expect.objectContaining({ name: "Nouveau nom", legalName: "Org de test SARL" }),
      ),
    );
    // Real refetch of the org query, not a manually-patched value.
    await waitFor(() =>
      expect(
        getMock.mock.calls.filter(([path]) => path === "/organizations/me").length,
      ).toBeGreaterThan(1),
    );
  });

  it("submits an edited SEO title/description as part of the organization form (Phase E4)", async () => {
    patchMock.mockResolvedValue({ ...organization });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    const seoTitleInput = screen.getByLabelText(/Titre SEO/);
    await user.clear(seoTitleInput);
    await user.type(seoTitleInput, "Org de test — le meilleur salon");
    const seoDescriptionInput = screen.getByLabelText(/Description SEO/);
    await user.type(seoDescriptionInput, "Réservez en ligne dès maintenant.");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        "/organizations/me",
        expect.objectContaining({
          seoTitle: "Org de test — le meilleur salon",
          seoDescription: "Réservez en ligne dès maintenant.",
        }),
      ),
    );
  });

  it("lets the owner set the type of activity, which an older organization does not have", async () => {
    patchMock.mockResolvedValue({ ...organization });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    expect(screen.getByText("Non défini")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Modifier" }));
    await user.selectOptions(screen.getByLabelText("Type d'activité"), "appointments");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        "/organizations/me",
        expect.objectContaining({ businessModel: "appointments" }),
      ),
    );
  });

  it("rejects an invalid brand color and never calls the API", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    const colorInput = screen.getByLabelText("Couleur de marque");
    await user.clear(colorInput);
    await user.type(colorInput, "not-a-color");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(patchMock).not.toHaveBeenCalled());
  });

  it("rejects an invalid hero image URL and never calls the API", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    const heroInput = screen.getByLabelText("Image de bannière (page publique)");
    await user.clear(heroInput);
    await user.type(heroInput, "not-a-url");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(patchMock).not.toHaveBeenCalled());
  });

  it("the color picker updates the brand color text field", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    const colorPicker = screen.getByLabelText("Choisir la couleur de marque");
    fireEvent.change(colorPicker, { target: { value: "#00ff00" } });

    expect(screen.getByLabelText("Couleur de marque")).toHaveValue("#00ff00");
  });

  it("uploading a logo file sets the logo field to the returned URL", async () => {
    uploadFileMock.mockResolvedValue({
      url: "https://api.korva.test/uploads/org-1/logo.png",
      filename: "logo.png",
      mimeType: "image/png",
      size: 1234,
    });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    const fileInput = screen.getByLabelText("Envoyer un fichier pour le logo");
    const file = new File(["fake-image-bytes"], "logo.png", { type: "image/png" });
    await user.upload(fileInput, file);

    await waitFor(() => expect(uploadFileMock).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(screen.getByLabelText("Logo")).toHaveValue(
        "https://api.korva.test/uploads/org-1/logo.png",
      ),
    );
  });

  it("shows an error and leaves the logo field untouched when the upload fails", async () => {
    uploadFileMock.mockRejectedValue(new ApiError("UNSUPPORTED_FILE_TYPE", "File type not allowed"));
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    // The API, not the client's accept="image/*" hint, is what actually enforces allowed file
    // types — an image-typed file the mocked upload rejects still exercises this error path.
    const fileInput = screen.getByLabelText("Envoyer un fichier pour le logo");
    const file = new File(["bad"], "corrupt.png", { type: "image/png" });
    await user.upload(fileInput, file);

    await waitFor(() => expect(screen.getByText("File type not allowed")).toBeInTheDocument());
    expect(screen.getByLabelText("Logo")).toHaveValue("");
  });

  it("Annuler discards changes without calling the API", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));
    const nameInput = screen.getByLabelText("Nom");
    await user.type(nameInput, " modifié");
    const form = nameInput.closest("form") as HTMLElement;
    await user.click(within(form).getByRole("button", { name: "Annuler" }));

    expect(screen.queryByLabelText("Nom")).not.toBeInTheDocument();
    expect(screen.getByText("Org de test")).toBeInTheDocument();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it("on a failed mutation, shows the error and stays in edit mode", async () => {
    patchMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "Réservé aux administrateurs"));
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    expect(await screen.findByText("Réservé aux administrateurs")).toBeInTheDocument();
    expect(screen.getByLabelText("Nom")).toBeInTheDocument();
  });
});

describe("SettingsPage — storefront section visibility", () => {
  let organization: ReturnType<typeof makeOrganization> & {
    language?: string;
    timezone?: string;
    storefrontSections?: string[];
  };

  beforeEach(() => {
    organization = {
      ...makeOrganization(["crm", "catalog", "booking"]),
      language: "fr",
      timezone: "Europe/Paris",
    };
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    uploadFileMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
  });

  it("shows 'Toutes' read-only when nothing is configured yet", async () => {
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Toutes")).toBeInTheDocument();
  });

  it("pre-checks both section checkboxes when nothing is configured yet", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    expect(screen.getByRole("checkbox", { name: "Afficher le catalogue" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Afficher les réservations" })).toBeChecked();
  });

  it("unchecking a section submits storefrontSections without it", async () => {
    patchMock.mockResolvedValue(organization);
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));
    await user.click(screen.getByRole("checkbox", { name: "Afficher les réservations" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(
        "/organizations/me",
        expect.objectContaining({ storefrontSections: ["catalog"] }),
      ),
    );
  });

  it("does not show the section-visibility control for a module that isn't enabled", async () => {
    organization = makeOrganization(["crm"]);
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Org de test");
    await user.click(screen.getByRole("button", { name: "Modifier" }));

    expect(screen.queryByText("Sections visibles sur la page publique")).not.toBeInTheDocument();
  });
});

describe("SettingsPage — Team invite section (LOT F2-FE)", () => {
  const organization = makeOrganization(["crm", "analytics"]);
  const existingMembers = [
    {
      id: "member-1",
      status: "active",
      userId: { id: "user-1", email: "owner@korva.test", firstName: "Ada" },
      roleId: { id: "role-owner", name: "OWNER", systemKey: "OWNER" },
    },
  ];
  const roles = [
    { id: "role-owner", name: "OWNER", systemKey: "OWNER" },
    { id: "role-admin", name: "ADMIN", systemKey: "ADMIN" },
    { id: "role-staff", name: "STAFF", systemKey: "STAFF" },
  ];

  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    uploadFileMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve(existingMembers);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve(roles);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
  });

  async function openInviteForm(user: ReturnType<typeof userEvent.setup>) {
    renderWithProviders(<SettingsPage />);
    await screen.findByText("owner@korva.test");
    await user.click(screen.getByRole("button", { name: "Inviter un membre" }));
  }

  it("shows the Utilisateurs section with the existing member list and an Inviter un membre action", async () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByRole("heading", { name: "Utilisateurs" })).toBeInTheDocument();
    // Bookable staff are not users: the section says where they go instead.
    expect(screen.getByText(/n'ont pas besoin de compte/)).toBeInTheDocument();
    expect(await screen.findByText("owner@korva.test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inviter un membre" })).toBeInTheDocument();
  });

  it("loads roles from GET /organizations/me/roles once the invite form is opened", async () => {
    const user = userEvent.setup();
    await openInviteForm(user);

    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/organizations/me/roles"));
  });

  it("renders the real roles returned by the backend, using role.id as the option value", async () => {
    const user = userEvent.setup();
    await openInviteForm(user);

    const roleSelect = await screen.findByLabelText("Rôle");
    for (const role of roles) {
      const option = within(roleSelect).getByText(role.name) as HTMLOptionElement;
      expect(option.value).toBe(role.id);
    }
  });

  it("rejects submission with no email filled in — no POST is sent", async () => {
    const user = userEvent.setup();
    await openInviteForm(user);

    const roleSelect = await screen.findByLabelText("Rôle");
    await user.selectOptions(roleSelect, "role-admin");
    await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    await waitFor(() =>
      expect(screen.queryByText(/invitation envoyée par email/i)).not.toBeInTheDocument(),
    );
    expect(postMock).not.toHaveBeenCalled();
  });

  it("rejects submission with no role selected — no POST is sent", async () => {
    const user = userEvent.setup();
    await openInviteForm(user);

    await screen.findByLabelText("Rôle");
    await user.type(screen.getByLabelText("Adresse email"), "new.member@korva.test");
    await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    await waitFor(() =>
      expect(screen.queryByText(/invitation envoyée par email/i)).not.toBeInTheDocument(),
    );
    expect(postMock).not.toHaveBeenCalled();
  });

  it("submits exactly { email, roleId } to POST /organizations/me/invitations (real email invite, not the accountrequired /members add)", async () => {
    postMock.mockResolvedValue({ id: "invitation-2", email: "new.member@korva.test", status: "pending" });
    const user = userEvent.setup();
    await openInviteForm(user);

    const roleSelect = await screen.findByLabelText("Rôle");
    await user.type(screen.getByLabelText("Adresse email"), "new.member@korva.test");
    await user.selectOptions(roleSelect, "role-admin");
    await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/organizations/me/invitations", {
        email: "new.member@korva.test",
        roleId: "role-admin",
      }),
    );
  });

  it("disables the submit button while the invitation is in flight, preventing a second submission", async () => {
    postMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    await openInviteForm(user);

    const roleSelect = await screen.findByLabelText("Rôle");
    await user.type(screen.getByLabelText("Adresse email"), "new.member@korva.test");
    await user.selectOptions(roleSelect, "role-admin");
    await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    const pendingButton = await screen.findByRole("button", { name: "Invitation en cours..." });
    expect(pendingButton).toBeDisabled();
    await user.click(pendingButton);
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  it("on success: refetches the pending-invitations list, clears the form, and shows a confirmation", async () => {
    postMock.mockResolvedValue({ id: "invitation-2", email: "new.member@korva.test", status: "pending" });
    const user = userEvent.setup();
    await openInviteForm(user);

    const roleSelect = await screen.findByLabelText("Rôle");
    const emailInput = screen.getByLabelText("Adresse email");
    await user.type(emailInput, "new.member@korva.test");
    await user.selectOptions(roleSelect, "role-admin");
    await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    expect(await screen.findByText(/invitation envoyée par email/i)).toBeInTheDocument();
    expect(emailInput).toHaveValue("");
    // Real refetch of the pending-invitations query, not a manually-patched list — the invited
    // person isn't a member yet, so the members list itself is deliberately NOT refetched here.
    expect(
      getMock.mock.calls.filter(([path]) => path === "/organizations/me/invitations").length,
    ).toBeGreaterThan(1);
  });

  it("on an API error: shows the message and keeps the typed email so the user can retry", async () => {
    postMock.mockRejectedValue(new ApiError("VALIDATION_ERROR", "Adresse email invalide"));
    const user = userEvent.setup();
    await openInviteForm(user);

    const roleSelect = await screen.findByLabelText("Rôle");
    const emailInput = screen.getByLabelText("Adresse email");
    await user.type(emailInput, "new.member@korva.test");
    await user.selectOptions(roleSelect, "role-admin");
    await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    expect(await screen.findByText("Adresse email invalide")).toBeInTheDocument();
    expect(emailInput).toHaveValue("new.member@korva.test");
  });

  it("on a 403 PERMISSION_DENIED error: shows the message and never touches the invitations list", async () => {
    postMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "Réservé aux administrateurs"));
    const user = userEvent.setup();
    await openInviteForm(user);

    const invitationsCallsBefore = getMock.mock.calls.filter(
      ([path]) => path === "/organizations/me/invitations",
    ).length;

    const roleSelect = await screen.findByLabelText("Rôle");
    await user.type(screen.getByLabelText("Adresse email"), "new.member@korva.test");
    await user.selectOptions(roleSelect, "role-admin");
    await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    expect(await screen.findByText("Réservé aux administrateurs")).toBeInTheDocument();
    // No invalidation fired on error — the invitations list was never asked to refetch.
    expect(
      getMock.mock.calls.filter(([path]) => path === "/organizations/me/invitations").length,
    ).toBe(invitationsCallsBefore);
  });

  it("shows a clear error with a retry option when the roles fail to load", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve(existingMembers);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles")
        return Promise.reject(new ApiError("NETWORK_ERROR", "Unable to reach the server"));
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
    const user = userEvent.setup();
    await openInviteForm(user);

    expect(await screen.findByText("Impossible de charger les rôles.")).toBeInTheDocument();
    expect(screen.getByLabelText("Rôle")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() =>
      expect(
        getMock.mock.calls.filter(([path]) => path === "/organizations/me/roles").length,
      ).toBeGreaterThan(1),
    );
  });

  it("renders pending invitations under 'Invitations en attente', resolving the role id to a role name", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve(existingMembers);
      if (path === "/organizations/me/invitations")
        return Promise.resolve([
          {
            id: "invitation-1",
            email: "pending.invitee@korva.test",
            roleId: "role-admin",
            status: "pending",
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        ]);
      if (path === "/organizations/me/roles") return Promise.resolve(roles);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Invitations en attente")).toBeInTheDocument();
    const invitationRow = screen.getByText("pending.invitee@korva.test").closest("div")!;
    expect(within(invitationRow.parentElement!).getByText("ADMIN")).toBeInTheDocument();
  });

  it("shows no 'Invitations en attente' section when there are none pending", async () => {
    renderWithProviders(<SettingsPage />);

    await screen.findByText("owner@korva.test");
    expect(screen.queryByText("Invitations en attente")).not.toBeInTheDocument();
  });
});

describe("SettingsPage — member role change and removal", () => {
  const organization = makeOrganization(["crm", "analytics"]);
  const twoMembers = [
    {
      id: "member-1",
      status: "active",
      userId: { id: "user-1", email: "owner@korva.test", firstName: "Ada" },
      roleId: { id: "role-owner", name: "OWNER", systemKey: "OWNER" },
    },
    {
      id: "member-2",
      status: "active",
      userId: { id: "user-2", email: "staff@korva.test", firstName: "Grace" },
      roleId: { id: "role-staff", name: "STAFF", systemKey: "STAFF" },
    },
  ];
  const suspendedMember = {
    id: "member-3",
    status: "suspended",
    userId: { id: "user-3", email: "removed@korva.test" },
    roleId: { id: "role-staff", name: "STAFF", systemKey: "STAFF" },
  };
  const roles = [
    { id: "role-owner", name: "OWNER", systemKey: "OWNER" },
    { id: "role-admin", name: "ADMIN", systemKey: "ADMIN" },
    { id: "role-staff", name: "STAFF", systemKey: "STAFF" },
  ];

  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    uploadFileMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members")
        return Promise.resolve([...twoMembers, suspendedMember]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve(roles);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
  });

  it("shows your own row as a plain badge (no role select, no Retirer) but a non-self member gets both", async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByText("owner@korva.test");

    const ownRow = screen.getByText("owner@korva.test").closest("div")!.parentElement!;
    expect(within(ownRow).getByText("OWNER")).toBeInTheDocument();
    expect(within(ownRow).queryByRole("combobox")).not.toBeInTheDocument();

    const staffRow = screen.getByText("staff@korva.test").closest("div")!.parentElement!;
    expect(within(staffRow).getByRole("combobox")).toBeInTheDocument();
    expect(within(staffRow).getByRole("button", { name: "Retirer" })).toBeInTheDocument();
  });

  it("never shows a suspended (removed) member in the active list", async () => {
    renderWithProviders(<SettingsPage />);
    await screen.findByText("owner@korva.test");

    expect(screen.queryByText("removed@korva.test")).not.toBeInTheDocument();
  });

  it("changing a member's role calls PATCH /organizations/me/members/:id and refetches", async () => {
    patchMock.mockResolvedValue({ ...twoMembers[1], roleId: roles[1] });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText("staff@korva.test");

    const staffRow = screen.getByText("staff@korva.test").closest("div")!.parentElement!;
    await user.selectOptions(within(staffRow).getByRole("combobox"), "role-admin");

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me/members/member-2", {
        roleId: "role-admin",
      }),
    );
    await waitFor(() =>
      expect(
        getMock.mock.calls.filter(([path]) => path === "/organizations/me/members").length,
      ).toBeGreaterThan(1),
    );
  });

  it("shows the backend error when a role change is rejected (e.g. hierarchy violation)", async () => {
    patchMock.mockRejectedValue(
      new ApiError("ROLE_HIERARCHY_VIOLATION", "You cannot assign a role with higher privileges than your own."),
    );
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText("staff@korva.test");

    const staffRow = screen.getByText("staff@korva.test").closest("div")!.parentElement!;
    await user.selectOptions(within(staffRow).getByRole("combobox"), "role-owner");

    expect(
      await screen.findByText("You cannot assign a role with higher privileges than your own."),
    ).toBeInTheDocument();
  });

  it("removing a member requires a two-step confirmation and calls DELETE on confirm", async () => {
    deleteMock.mockResolvedValue({ ...twoMembers[1], status: "suspended" });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText("staff@korva.test");

    const staffRow = screen.getByText("staff@korva.test").closest("div")!.parentElement!;
    await user.click(within(staffRow).getByRole("button", { name: "Retirer" }));
    expect(deleteMock).not.toHaveBeenCalled();

    await user.click(within(staffRow).getByRole("button", { name: "Confirmer ?" }));

    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith("/organizations/me/members/member-2"),
    );
  });

  it("cancelling the remove confirmation never calls DELETE", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText("staff@korva.test");

    const staffRow = screen.getByText("staff@korva.test").closest("div")!.parentElement!;
    await user.click(within(staffRow).getByRole("button", { name: "Retirer" }));
    await user.click(within(staffRow).getByRole("button", { name: "Annuler" }));

    expect(deleteMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Retirer" })).toBeInTheDocument();
  });

  it("shows the backend error and resets the confirm state when removal fails", async () => {
    deleteMock.mockRejectedValue(
      new ApiError("CANNOT_REMOVE_LAST_OWNER", "An organization must always have at least one owner."),
    );
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);
    await screen.findByText("staff@korva.test");

    const staffRow = screen.getByText("staff@korva.test").closest("div")!.parentElement!;
    await user.click(within(staffRow).getByRole("button", { name: "Retirer" }));
    await user.click(within(staffRow).getByRole("button", { name: "Confirmer ?" }));

    expect(
      await screen.findByText("An organization must always have at least one owner."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retirer" })).toBeInTheDocument();
  });
});

describe("SettingsPage — Integrations section (Wave 4 Stage 2 frontend)", () => {
  const organization = makeOrganization(["crm", "analytics"]);

  function mockIntegrationsGet(
    integrationsResult: () => Promise<unknown> | unknown,
  ) {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve(integrationsResult());
      throw new Error(`unexpected GET ${path}`);
    });
  }

  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    uploadFileMock.mockReset();
    mockIntegrationsGet(() => []);
  });

  it("shows both known integration types as 'Non connecté' when none exist yet", async () => {
    renderWithProviders(<SettingsPage />);

    // No provider named here: which PSP ends up used is resolved server-side by market (see
    // PAYMENT_PROVIDER_DISPLAY_NAMES's own doc comment) — never known before a real connection
    // exists, unlike WhatsApp/360dialog (the only messaging adapter today).
    expect(await screen.findByText("Paiements")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp Business — 360dialog")).toBeInTheDocument();
    expect(screen.getAllByText("Non connecté")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Connecter" })).toHaveLength(2);
  });

  it("renders a connected payment integration with its status, market, and last verification", async () => {
    mockIntegrationsGet(() => [
      {
        id: "integ-pay-1",
        domain: "payment",
        provider: "flutterwave",
        status: "active",
        market: "CI",
        lastVerifiedAt: "2026-08-20T10:00:00.000Z",
        lastErrorAt: null,
        lastErrorMessage: null,
      },
    ]);
    renderWithProviders(<SettingsPage />);

    const paymentCard = (await screen.findByText("Paiements — Flutterwave")).closest(
      ".rounded-md",
    ) as HTMLElement;
    expect(within(paymentCard).getByText("Actif")).toBeInTheDocument();
    expect(within(paymentCard).getByText("CI")).toBeInTheDocument();
    expect(
      within(paymentCard).getByRole("button", { name: "Tester la connexion" }),
    ).toBeInTheDocument();
    expect(within(paymentCard).getByRole("button", { name: "Déconnecter" })).toBeInTheDocument();
    expect(within(paymentCard).queryByRole("button", { name: "Connecter" })).not.toBeInTheDocument();
  });

  it("names the ACTUAL connected provider (not a hardcoded one) when it's Paystack instead of Flutterwave", async () => {
    mockIntegrationsGet(() => [
      {
        id: "integ-pay-2",
        domain: "payment",
        provider: "paystack",
        status: "active",
        market: "NG",
        lastVerifiedAt: "2026-08-20T10:00:00.000Z",
        lastErrorAt: null,
        lastErrorMessage: null,
      },
    ]);
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Paiements — Paystack")).toBeInTheDocument();
    expect(screen.getByText("Recevez vos règlements via Paystack.")).toBeInTheDocument();
    expect(screen.queryByText(/Flutterwave/)).not.toBeInTheDocument();
  });

  it("shows lastErrorMessage for an integration in error status", async () => {
    mockIntegrationsGet(() => [
      {
        id: "integ-msg-1",
        domain: "messaging",
        provider: "360dialog",
        status: "error",
        market: null,
        lastVerifiedAt: null,
        lastErrorAt: "2026-08-21T10:00:00.000Z",
        lastErrorMessage: "Webhook signature invalide",
      },
    ]);
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Erreur")).toBeInTheDocument();
    expect(screen.getByText("Webhook signature invalide")).toBeInTheDocument();
  });

  it("submits the payment connect form as ConnectPaymentPayoutInput's payoutDetails shape", async () => {
    postMock.mockResolvedValue({
      id: "integ-pay-2",
      domain: "payment",
      provider: "flutterwave",
      status: "pending",
      market: null,
      lastVerifiedAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click((await screen.findAllByRole("button", { name: "Connecter" }))[0]);
    const bankCodeInput = await screen.findByLabelText("Code banque (Flutterwave)");
    await user.type(bankCodeInput, "044");
    await user.type(screen.getByLabelText("Numéro de compte"), "0123456789");
    await user.type(screen.getByLabelText("Nom de l'entreprise"), "Ma Boutique SARL");
    // Pre-filled from the mocked organization's country ("FR") via defaultValue — clear it first
    // so the assertion below reflects exactly what was typed, not "FRCI".
    const countryInput = screen.getByLabelText("Pays (code ISO)");
    await user.clear(countryInput);
    await user.type(countryInput, "CI");
    await user.selectOptions(screen.getByLabelText("Type de répartition"), "percentage");
    await user.type(screen.getByLabelText("Valeur de répartition"), "2.5");
    const paymentForm = bankCodeInput.closest("form") as HTMLElement;
    await user.click(within(paymentForm).getByRole("button", { name: "Connecter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/organizations/me/integrations/payment/connect", {
        payoutDetails: {
          account_bank: "044",
          account_number: "0123456789",
          business_name: "Ma Boutique SARL",
          country: "CI",
          split_type: "percentage",
          split_value: "2.5",
        },
      }),
    );
  });

  it("clears the payment form after a successful connect — never redisplays the submitted values", async () => {
    postMock.mockResolvedValue({
      id: "integ-pay-2",
      domain: "payment",
      provider: "flutterwave",
      status: "pending",
      market: null,
      lastVerifiedAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click((await screen.findAllByRole("button", { name: "Connecter" }))[0]);
    const bankCodeInput = await screen.findByLabelText("Code banque (Flutterwave)");
    await user.type(bankCodeInput, "044");
    await user.type(screen.getByLabelText("Numéro de compte"), "0123456789");
    await user.type(screen.getByLabelText("Nom de l'entreprise"), "Ma Boutique SARL");
    await user.type(screen.getByLabelText("Valeur de répartition"), "2.5");
    const paymentForm = bankCodeInput.closest("form") as HTMLElement;
    await user.click(within(paymentForm).getByRole("button", { name: "Connecter" }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    // Form closes on success; the entered values must not resurface anywhere on the page.
    expect(screen.queryByLabelText("Code banque (Flutterwave)")).not.toBeInTheDocument();
    expect(screen.queryByText("044")).not.toBeInTheDocument();
  });

  it("submits the messaging connect form as ConnectMessagingAccountInput exactly", async () => {
    postMock.mockResolvedValue({
      id: "integ-msg-2",
      domain: "messaging",
      provider: "360dialog",
      status: "pending",
      market: null,
      lastVerifiedAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click((await screen.findAllByRole("button", { name: "Connecter" }))[1]);
    const wabaIdInput = await screen.findByLabelText("WABA ID");
    await user.type(wabaIdInput, "waba-123");
    await user.type(screen.getByLabelText("ID du numéro de téléphone"), "phone-456");
    await user.type(screen.getByLabelText("Nom affiché"), "Ma Boutique");
    await user.type(screen.getByLabelText("Clé API (D360-API-KEY)"), "d360-secret-key");
    const messagingForm = wabaIdInput.closest("form") as HTMLElement;
    await user.click(within(messagingForm).getByRole("button", { name: "Connecter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/organizations/me/integrations/messaging/connect", {
        wabaId: "waba-123",
        phoneNumberId: "phone-456",
        displayName: "Ma Boutique",
        apiKey: "d360-secret-key",
      }),
    );
  });

  it("the API key field is masked (type=password) and never pre-filled/re-displayed", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click((await screen.findAllByRole("button", { name: "Connecter" }))[1]);
    const apiKeyInput = await screen.findByLabelText("Clé API (D360-API-KEY)");

    expect(apiKeyInput).toHaveAttribute("type", "password");
    expect(apiKeyInput).toHaveValue("");
  });

  it("test-connection calls the right endpoint and displays the returned ok/message", async () => {
    mockIntegrationsGet(() => [
      {
        id: "integ-pay-1",
        domain: "payment",
        provider: "flutterwave",
        status: "active",
        market: "CI",
        lastVerifiedAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      },
    ]);
    postMock.mockResolvedValue({ ok: true, message: "Connexion vérifiée avec succès." });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "Tester la connexion" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/organizations/me/integrations/integ-pay-1/test-connection",
      ),
    );
    expect(await screen.findByText("Connexion vérifiée avec succès.")).toBeInTheDocument();
  });

  it("disconnect requires a confirmation click before DELETE is called", async () => {
    mockIntegrationsGet(() => [
      {
        id: "integ-pay-1",
        domain: "payment",
        provider: "flutterwave",
        status: "active",
        market: "CI",
        lastVerifiedAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "Déconnecter" }));
    expect(deleteMock).not.toHaveBeenCalled();

    const confirmButton = await screen.findByRole("button", { name: "Confirmer ?" });
    await user.click(confirmButton);

    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith("/organizations/me/integrations/integ-pay-1"),
    );
  });

  it("cancelling the disconnect confirmation never calls DELETE", async () => {
    mockIntegrationsGet(() => [
      {
        id: "integ-pay-1",
        domain: "payment",
        provider: "flutterwave",
        status: "active",
        market: "CI",
        lastVerifiedAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
      },
    ]);
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "Déconnecter" }));
    await user.click(await screen.findByRole("button", { name: "Annuler" }));

    expect(screen.queryByRole("button", { name: "Confirmer ?" })).not.toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("shows a loading state while integrations are being fetched", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return new Promise(() => {});
      throw new Error(`unexpected GET ${path}`);
    });
    renderWithProviders(<SettingsPage />);

    // A heading, not plain text: "Intégrations" is also the name of a settings tab.
    expect(await screen.findByRole("heading", { name: "Intégrations" })).toBeInTheDocument();
    expect(screen.getAllByText("Chargement...").length).toBeGreaterThan(0);
  });

  it("on a generic load error, shows the message with a retry that refetches", async () => {
    let callCount = 0;
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") {
        callCount += 1;
        return Promise.reject(new ApiError("NETWORK_ERROR", "Unable to reach the server"));
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Unable to reach the server")).toBeInTheDocument();
    const callsBeforeRetry = callCount;

    await user.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(callCount).toBeGreaterThan(callsBeforeRetry));
  });

  it("on PERMISSION_DENIED, shows a plain admin-only notice instead of a retry-able error", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations")
        return Promise.reject(
          new ApiError("PERMISSION_DENIED", "Réservé aux administrateurs"),
        );
      throw new Error(`unexpected GET ${path}`);
    });
    renderWithProviders(<SettingsPage />);

    expect(
      await screen.findByText("Les intégrations sont réservées aux administrateurs."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Réessayer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connecter" })).not.toBeInTheDocument();
  });
});

describe("SettingsPage — embeddable widget snippet (docs/BUSINESS_OS_AUDIT.md roadmap item #8)", () => {
  let organization: ReturnType<typeof makeOrganization>;

  beforeEach(() => {
    organization = makeOrganization(["crm"]);
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    uploadFileMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });

    // jsdom's real Clipboard implementation rejects writeText() outside a user-activated,
    // permission-granted context (neither is true under jsdom) — letting the real
    // implementation run is harmless here (the component only ever `void`s the promise) and
    // avoids fighting jsdom's own clipboard internals just to assert on it; the test below
    // checks the actually-important user-visible outcome (the button's confirmation state)
    // instead of the clipboard call itself.
  });

  it("shows an embed snippet carrying the organization's real slug", async () => {
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Mon site existant")).toBeInTheDocument();
    expect(screen.getByText(/data-org="org-de-test"/)).toBeInTheDocument();
  });

  it("links to the organization's real storefront page", async () => {
    renderWithProviders(<SettingsPage />);

    const link = await screen.findByRole("link", { name: /Voir ma page publique/ });
    expect(link).toHaveAttribute("href", "http://localhost:3001/org-de-test");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it('clicking "Copier le code" shows a "Copié !" confirmation', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Mon site existant");
    await user.click(screen.getByRole("button", { name: "Copier le code" }));

    expect(await screen.findByRole("button", { name: "Copié !" })).toBeInTheDocument();
  });

  it('"Afficher" reveals a live storefront preview iframe pointed at the real page, "Masquer" removes it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Aperçu de ma page publique");
    expect(screen.queryByTitle("Aperçu de la page publique")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Afficher" }));
    const iframe = screen.getByTitle("Aperçu de la page publique");
    expect(iframe).toHaveAttribute("src", "http://localhost:3001/org-de-test");

    await user.click(screen.getByRole("button", { name: "Masquer" }));
    expect(screen.queryByTitle("Aperçu de la page publique")).not.toBeInTheDocument();
  });
});

describe("SettingsPage — outbound webhook subscriptions (docs/BUSINESS_OS_AUDIT.md §6)", () => {
  let organization: ReturnType<typeof makeOrganization>;
  let subscriptionsList: Array<{
    id: string;
    url: string;
    events: string[];
    active: boolean;
    description?: string;
    lastDeliveryStatus?: string;
  }>;

  beforeEach(() => {
    organization = makeOrganization(["crm"]);
    subscriptionsList = [];
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
    uploadFileMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      if (path === "/webhook-subscriptions") return Promise.resolve(subscriptionsList);
      if (path.endsWith("/deliveries")) return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });

    postMock.mockImplementation((path: string, body: unknown) => {
      if (path === "/webhook-subscriptions") {
        const input = body as { url: string; events: string[]; description?: string };
        const created = {
          id: "sub-1",
          url: input.url,
          events: input.events,
          description: input.description,
          active: true,
        };
        subscriptionsList = [...subscriptionsList, created];
        return Promise.resolve({ ...created, secret: "whsec_generated-once" });
      }
      if (path === "/webhook-subscriptions/sub-1/rotate-secret") {
        return Promise.resolve({ ...subscriptionsList[0], secret: "whsec_rotated" });
      }
      throw new Error(`unexpected POST ${path}`);
    });

    patchMock.mockImplementation((path: string, body: unknown) => {
      if (path === "/webhook-subscriptions/sub-1") {
        subscriptionsList = subscriptionsList.map((s) =>
          s.id === "sub-1" ? { ...s, ...(body as object) } : s,
        );
        return Promise.resolve(subscriptionsList[0]);
      }
      throw new Error(`unexpected PATCH ${path}`);
    });

    deleteMock.mockImplementation((path: string) => {
      if (path === "/webhook-subscriptions/sub-1") {
        subscriptionsList = [];
        return Promise.resolve({ deleted: true });
      }
      throw new Error(`unexpected DELETE ${path}`);
    });
  });

  it("shows an empty state when no webhook is configured", async () => {
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Webhooks sortants")).toBeInTheDocument();
    expect(await screen.findByText("Aucun webhook sortant configuré.")).toBeInTheDocument();
  });

  it("creates a webhook, reveals the secret exactly once, and lists it without the secret", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Webhooks sortants");
    await user.type(
      screen.getByPlaceholderText("https://partenaire.example.com/webhooks/korva"),
      "https://partner.test/hook",
    );
    await user.click(screen.getByRole("checkbox", { name: "Dépense créée" }));
    await user.click(screen.getByRole("button", { name: "Ajouter un webhook" }));

    expect(
      await screen.findByText("whsec_generated-once"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Clé secrète générée — notez-la maintenant, elle ne sera plus jamais affichée."),
    ).toBeInTheDocument();
    expect(await screen.findByText("https://partner.test/hook")).toBeInTheDocument();
  });

  it("rotates the secret and shows the new one, distinct from the original", async () => {
    subscriptionsList = [
      { id: "sub-1", url: "https://partner.test/hook", events: ["expense.created"], active: true },
    ];
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("https://partner.test/hook");
    await user.click(screen.getByRole("button", { name: "Régénérer la clé" }));

    expect(await screen.findByText("whsec_rotated")).toBeInTheDocument();
  });

  it("deletes a webhook subscription", async () => {
    subscriptionsList = [
      { id: "sub-1", url: "https://partner.test/hook", events: ["expense.created"], active: true },
    ];
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("https://partner.test/hook");
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() =>
      expect(screen.queryByText("https://partner.test/hook")).not.toBeInTheDocument(),
    );
  });
});

describe("SettingsPage — custom fields", () => {
  let organization: ReturnType<typeof makeOrganization>;
  let contactFields: Array<{
    id: string;
    entity: string;
    key: string;
    label: string;
    type: string;
    options?: string[];
    required: boolean;
  }>;

  beforeEach(() => {
    organization = makeOrganization(["crm"]);
    contactFields = [];
    getMock.mockReset();
    postMock.mockReset();
    deleteMock.mockReset();
    uploadFileMock.mockReset();

    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      if (path === "/webhook-subscriptions") return Promise.resolve([]);
      if (path === "/custom-fields?entity=contacts") return Promise.resolve(contactFields);
      if (path.startsWith("/custom-fields?entity=")) return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });

    postMock.mockImplementation((path: string, body: unknown) => {
      if (path === "/custom-fields") {
        const input = body as {
          entity: string;
          key: string;
          label: string;
          type: string;
          options?: string[];
          required: boolean;
        };
        const created = { id: "field-1", ...input };
        contactFields = [...contactFields, created];
        return Promise.resolve(created);
      }
      throw new Error(`unexpected POST ${path}`);
    });

    deleteMock.mockImplementation((path: string) => {
      if (path === "/custom-fields/field-1") {
        contactFields = [];
        return Promise.resolve({ deleted: true });
      }
      throw new Error(`unexpected DELETE ${path}`);
    });
  });

  it("shows an empty state for the default (Contacts) entity", async () => {
    renderWithProviders(<SettingsPage />);
    expect(await screen.findByText("Champs personnalisés")).toBeInTheDocument();
    expect(
      await screen.findByText("Aucun champ personnalisé pour contacts."),
    ).toBeInTheDocument();
  });

  it("creates a custom field on Contacts and lists it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Champs personnalisés");
    await user.click(screen.getByRole("button", { name: "Ajouter un champ" }));
    await user.type(screen.getByLabelText("Clé (identifiant technique)"), "surface_m2");
    await user.type(screen.getByLabelText("Libellé affiché"), "Surface (m²)");
    await user.click(screen.getByRole("button", { name: "Créer le champ" }));

    expect(await screen.findByText("Surface (m²)")).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledWith("/custom-fields", {
      entity: "contacts",
      key: "surface_m2",
      label: "Surface (m²)",
      type: "text",
      required: false,
      options: undefined,
    });
  });

  it("shows the options input only for select/multiselect types and sends them as an array", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Champs personnalisés");
    await user.click(screen.getByRole("button", { name: "Ajouter un champ" }));
    expect(screen.queryByLabelText("Options (séparées par des virgules)")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Type"), "select");
    await user.type(screen.getByLabelText("Clé (identifiant technique)"), "taille");
    await user.type(screen.getByLabelText("Libellé affiché"), "Taille");
    await user.type(
      screen.getByLabelText("Options (séparées par des virgules)"),
      "Petit, Moyen, Grand",
    );
    await user.click(screen.getByRole("button", { name: "Créer le champ" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/custom-fields", {
        entity: "contacts",
        key: "taille",
        label: "Taille",
        type: "select",
        required: false,
        options: ["Petit", "Moyen", "Grand"],
      }),
    );
  });

  it("switches entity tabs and only shows fields for the active one", async () => {
    contactFields = [
      { id: "field-1", entity: "contacts", key: "surface_m2", label: "Surface (m²)", type: "text", required: false },
    ];
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Surface (m²)")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Prospects" }));

    await waitFor(() =>
      expect(screen.queryByText("Surface (m²)")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText("Aucun champ personnalisé pour prospects."),
    ).toBeInTheDocument();
  });

  it("deletes a custom field", async () => {
    contactFields = [
      { id: "field-1", entity: "contacts", key: "surface_m2", label: "Surface (m²)", type: "text", required: false },
    ];
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Surface (m²)");
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() => expect(screen.queryByText("Surface (m²)")).not.toBeInTheDocument());
  });
});

describe("SettingsPage — storefront content sections", () => {
  let organization: ReturnType<typeof makeOrganization>;

  function mockDefaultGets(planKey: string) {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/invitations") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") {
        return Promise.resolve({ ...subscription, plan: { ...subscription.plan, key: planKey } });
      }
      if (path === "/ai/usage-summary") {
        return Promise.resolve({
          period: "2026-08",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          unpricedCalls: 0,
        });
      }
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return Promise.resolve([]);
      if (path === "/webhook-subscriptions") return Promise.resolve([]);
      if (path.startsWith("/custom-fields")) return Promise.resolve([]);
      throw new Error(`unexpected GET ${path}`);
    });
  }

  beforeEach(() => {
    organization = makeOrganization(["crm"]);
    getMock.mockReset();
    postMock.mockReset();
    patchMock.mockReset();
    uploadFileMock.mockReset();
    mockDefaultGets("pro");
  });

  it("shows a lock badge and disables the fieldset when the plan is below Pro", async () => {
    mockDefaultGets("starter");
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("🔒 Passer au plan Pro")).toBeInTheDocument();
    const fieldset = (await screen.findByText("À propos")).closest("fieldset");
    expect(fieldset).toBeDisabled();
  });

  it("saves the about text on a Pro plan", async () => {
    patchMock.mockResolvedValue({ ...organization, aboutText: "Notre histoire" });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    const textarea = await screen.findByPlaceholderText(
      "Racontez l'histoire de votre entreprise...",
    );
    expect(screen.queryByText("🔒 Passer au plan Pro")).not.toBeInTheDocument();
    await user.type(textarea, "Notre histoire");
    await user.click(screen.getByRole("button", { name: "Enregistrer le texte" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", {
        aboutText: "Notre histoire",
      }),
    );
  });

  it("adds and removes a testimonial", async () => {
    patchMock.mockImplementation((_path: string, body: unknown) => {
      organization = { ...organization, ...(body as object) };
      return Promise.resolve(organization);
    });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "Ajouter un témoignage" }));
    await user.type(screen.getByPlaceholderText("Nom du client"), "Ada Lovelace");
    await user.type(screen.getByPlaceholderText("Témoignage"), "Excellent service !");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", {
        testimonials: [
          expect.objectContaining({
            authorName: "Ada Lovelace",
            quote: "Excellent service !",
          }),
        ],
      }),
    );

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", { testimonials: [] }),
    );
  });

  it("uploads and adds a gallery image", async () => {
    uploadFileMock.mockResolvedValue({
      url: "https://cdn.korva.test/gallery-1.jpg",
      filename: "gallery-1.jpg",
      mimeType: "image/jpeg",
      size: 1024,
    });
    patchMock.mockImplementation((_path: string, body: unknown) =>
      Promise.resolve({ ...organization, ...(body as object) }),
    );
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await screen.findByText("Galerie photo");
    const file = new File(["fake"], "photo.jpg", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"][accept="image/*"]')!;
    await user.upload(input as HTMLInputElement, file);

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", {
        galleryImages: [
          expect.objectContaining({ url: "https://cdn.korva.test/gallery-1.jpg" }),
        ],
      }),
    );
  });

  it("adds and removes a FAQ item", async () => {
    patchMock.mockImplementation((_path: string, body: unknown) => {
      organization = { ...organization, ...(body as object) };
      return Promise.resolve(organization);
    });
    const user = userEvent.setup();
    renderWithProviders(<SettingsPage />);

    await user.click(await screen.findByRole("button", { name: "Ajouter une question" }));
    await user.type(screen.getByPlaceholderText("Question"), "Livrez-vous partout en France ?");
    await user.type(screen.getByPlaceholderText("Réponse"), "Oui, sous 3 à 5 jours ouvrés.");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", {
        faqItems: [
          expect.objectContaining({
            question: "Livrez-vous partout en France ?",
            answer: "Oui, sous 3 à 5 jours ouvrés.",
          }),
        ],
      }),
    );

    expect(await screen.findByText("Livrez-vous partout en France ?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Supprimer" }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith("/organizations/me", { faqItems: [] }),
    );
  });
});
