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
