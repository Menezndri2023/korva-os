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
    apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn(), patch: vi.fn() },
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

    getMock.mockImplementation((path: string) => {
      if (path === "/organizations/me") return Promise.resolve(organization);
      if (path === "/organizations/me/members") return Promise.resolve([]);
      if (path === "/subscriptions/me") return Promise.resolve(subscription);
      if (path === "/plans") return Promise.resolve([]);
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
