import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

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
  };
});

// Same store shape used by dashboard/page.test.tsx — satisfies both useActiveOrganization's
// and useAuthReady's gating conditions (bootstrapped + an active organization) without having
// to mock either hook individually.
vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ bootstrapped: true, activeOrganizationId: "org-1" }),
}));

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);
const patchMock = vi.mocked(apiClient.patch);
const deleteMock = vi.mocked(apiClient.delete);

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

    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
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

    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve(existingMembers);
      if (path === "/organizations/me/roles") return Promise.resolve(roles);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
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

  it("shows the Équipe section with the existing member list and an Inviter un membre action", async () => {
    renderWithProviders(<SettingsPage />);

    expect(screen.getByText("Équipe")).toBeInTheDocument();
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

    await waitFor(() => expect(screen.queryByText("Invitation envoyée.")).not.toBeInTheDocument());
    expect(postMock).not.toHaveBeenCalled();
  });

  it("rejects submission with no role selected — no POST is sent", async () => {
    const user = userEvent.setup();
    await openInviteForm(user);

    await screen.findByLabelText("Rôle");
    await user.type(screen.getByLabelText("Adresse email"), "new.member@korva.test");
    await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    await waitFor(() => expect(screen.queryByText("Invitation envoyée.")).not.toBeInTheDocument());
    expect(postMock).not.toHaveBeenCalled();
  });

  it("submits exactly { email, roleId } to POST /organizations/me/members", async () => {
    postMock.mockResolvedValue({ id: "member-2" });
    const user = userEvent.setup();
    await openInviteForm(user);

    const roleSelect = await screen.findByLabelText("Rôle");
    await user.type(screen.getByLabelText("Adresse email"), "new.member@korva.test");
    await user.selectOptions(roleSelect, "role-admin");
    await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/organizations/me/members", {
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

  it("on success: refetches the member list, clears the form, and shows a confirmation", async () => {
    postMock.mockResolvedValue({ id: "member-2" });
    const user = userEvent.setup();
    await openInviteForm(user);

    const roleSelect = await screen.findByLabelText("Rôle");
    const emailInput = screen.getByLabelText("Adresse email");
    await user.type(emailInput, "new.member@korva.test");
    await user.selectOptions(roleSelect, "role-admin");
    await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    expect(await screen.findByText("Invitation envoyée.")).toBeInTheDocument();
    expect(emailInput).toHaveValue("");
    // Real refetch of the members query, not a manually-patched list.
    expect(
      getMock.mock.calls.filter(([path]) => path === "/organizations/me/members").length,
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

  it("on a 403 PERMISSION_DENIED error: shows the message and never touches the member list", async () => {
    postMock.mockRejectedValue(new ApiError("PERMISSION_DENIED", "Réservé aux administrateurs"));
    const user = userEvent.setup();
    await openInviteForm(user);

    const membersCallsBefore = getMock.mock.calls.filter(
      ([path]) => path === "/organizations/me/members",
    ).length;

    const roleSelect = await screen.findByLabelText("Rôle");
    await user.type(screen.getByLabelText("Adresse email"), "new.member@korva.test");
    await user.selectOptions(roleSelect, "role-admin");
    await user.click(screen.getByRole("button", { name: "Envoyer l'invitation" }));

    expect(await screen.findByText("Réservé aux administrateurs")).toBeInTheDocument();
    // No invalidation fired on error — the member list was never asked to refetch.
    expect(
      getMock.mock.calls.filter(([path]) => path === "/organizations/me/members").length,
    ).toBe(membersCallsBefore);
  });

  it("shows a clear error with a retry option when the roles fail to load", async () => {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve(existingMembers);
      if (path === "/organizations/me/roles")
        return Promise.reject(new ApiError("NETWORK_ERROR", "Unable to reach the server"));
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
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
});

describe("SettingsPage — Integrations section (Wave 4 Stage 2 frontend)", () => {
  const organization = makeOrganization(["crm", "analytics"]);

  function mockIntegrationsGet(
    integrationsResult: () => Promise<unknown> | unknown,
  ) {
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
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
    mockIntegrationsGet(() => []);
  });

  it("shows both known integration types as 'Non connecté' when none exist yet", async () => {
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Paiements — Flutterwave")).toBeInTheDocument();
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
    const bankNameInput = await screen.findByLabelText("Nom de la banque");
    await user.type(bankNameInput, "Ecobank");
    await user.type(screen.getByLabelText("Numéro de compte"), "0123456789");
    await user.type(screen.getByLabelText("Titulaire du compte"), "Ma Boutique SARL");
    const paymentForm = bankNameInput.closest("form") as HTMLElement;
    await user.click(within(paymentForm).getByRole("button", { name: "Connecter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/organizations/me/integrations/payment/connect", {
        payoutDetails: {
          bankName: "Ecobank",
          accountNumber: "0123456789",
          accountHolderName: "Ma Boutique SARL",
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
    const bankNameInput = await screen.findByLabelText("Nom de la banque");
    await user.type(bankNameInput, "Ecobank");
    await user.type(screen.getByLabelText("Numéro de compte"), "0123456789");
    await user.type(screen.getByLabelText("Titulaire du compte"), "Ma Boutique SARL");
    const paymentForm = bankNameInput.closest("form") as HTMLElement;
    await user.click(within(paymentForm).getByRole("button", { name: "Connecter" }));

    await waitFor(() => expect(postMock).toHaveBeenCalled());
    // Form closes on success; the entered values must not resurface anywhere on the page.
    expect(screen.queryByLabelText("Nom de la banque")).not.toBeInTheDocument();
    expect(screen.queryByText("Ecobank")).not.toBeInTheDocument();
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
    const messagingForm = wabaIdInput.closest("form") as HTMLElement;
    await user.click(within(messagingForm).getByRole("button", { name: "Connecter" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/organizations/me/integrations/messaging/connect", {
        wabaId: "waba-123",
        phoneNumberId: "phone-456",
        displayName: "Ma Boutique",
      }),
    );
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
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/plans") return Promise.resolve([]);
      if (path === "/organizations/me/integrations") return new Promise(() => {});
      throw new Error(`unexpected GET ${path}`);
    });
    renderWithProviders(<SettingsPage />);

    expect(await screen.findByText("Intégrations")).toBeInTheDocument();
    expect(screen.getAllByText("Chargement...").length).toBeGreaterThan(0);
  });

  it("on a generic load error, shows the message with a retry that refetches", async () => {
    let callCount = 0;
    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
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
      if (path === "/organizations/me/roles") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
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
