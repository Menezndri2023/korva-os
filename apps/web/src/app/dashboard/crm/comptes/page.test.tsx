import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import CustomerAccountsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() } };
});
vi.mock("@/lib/use-auth-ready", () => ({ useAuthReady: () => true }));
const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

const awa = {
  id: "acc-1",
  contactId: "c-1",
  email: "awa@client.ci",
  name: "Awa Koné",
  createdAt: "2026-10-01T10:00:00.000Z",
  lastLoginAt: "2026-11-01T09:30:00.000Z",
};

describe("CustomerAccountsPage", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    postMock.mockResolvedValue({});
    getMock.mockImplementation(async (path: string) =>
      path === "/subscriptions/me" ? { plan: { key: "starter" }, subscription: {} } : [awa],
    );
  });

  it("lists the accounts with their state and last sign-in, linking to the customer", async () => {
    renderWithProviders(<CustomerAccountsPage />);
    expect(await screen.findByRole("link", { name: "Awa Koné" })).toHaveAttribute("href", "/dashboard/crm/c-1");
    expect(screen.getByText("Actif")).toBeInTheDocument();
    expect(screen.getByText("awa@client.ci")).toBeInTheDocument();
  });

  it("suspends an account only after confirming in the page, and sends a password link", async () => {
    renderWithProviders(<CustomerAccountsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Suspendre" }));
    expect(postMock).not.toHaveBeenCalled();
    expect(screen.getByText(/ne pourra plus se connecter/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la suspension" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/customer-accounts/acc-1/disable"));

    fireEvent.click(screen.getByRole("button", { name: "Envoyer un lien de mot de passe" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/customer-accounts/acc-1/password-reset"));
    expect(await screen.findByRole("button", { name: "Lien envoyé" })).toBeDisabled();
  });

  it("restores a suspended account in one click", async () => {
    getMock.mockImplementation(async (path: string) =>
      path === "/subscriptions/me"
        ? { plan: { key: "starter" }, subscription: {} }
        : [{ ...awa, disabledAt: "2026-11-01T10:00:00.000Z" }],
    );
    renderWithProviders(<CustomerAccountsPage />);
    expect(await screen.findByText("Suspendu")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Rétablir l'accès" }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith("/customer-accounts/acc-1/enable"));
  });

  it("invites a Free business to Starter, where accounts open", async () => {
    getMock.mockImplementation(async (path: string) =>
      path === "/subscriptions/me" ? { plan: { key: "free" }, subscription: {} } : [],
    );
    renderWithProviders(<CustomerAccountsPage />);
    expect(await screen.findByRole("link", { name: "Passer à Starter" })).toBeInTheDocument();
    expect(screen.getByText("Aucun client n'a encore créé de compte.")).toBeInTheDocument();
  });
});
