import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AcceptInvitationPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient, ApiError } from "@/lib/api-client";

const searchParamsMock = vi.fn();

vi.mock("next/navigation", () => ({
  useSearchParams: () => searchParamsMock(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, post: vi.fn() } };
});

const postMock = vi.mocked(apiClient.post);

function setToken(token: string | null) {
  searchParamsMock.mockReturnValue(new URLSearchParams(token ? { token } : {}));
}

async function submit() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /rejoindre l'organisation/i }));
  return user;
}

describe("AcceptInvitationPage", () => {
  beforeEach(() => {
    postMock.mockReset();
    setToken("good-token");
  });

  it("reads the token from ?token= and shows the form when present", () => {
    setToken("abc123");
    renderWithProviders(<AcceptInvitationPage />);
    expect(screen.getByLabelText(/mot de passe \(nouveau compte/i)).toBeInTheDocument();
  });

  it("shows an invalid-link state and makes no API call when the token is absent", () => {
    setToken(null);
    renderWithProviders(<AcceptInvitationPage />);

    expect(screen.getByText(/lien invalide/i)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("accepts with an empty password for an existing account and sends no password field", async () => {
    postMock.mockResolvedValue({
      organizationId: "org1",
      membershipId: "m1",
      roleId: "r1",
      userId: "u1",
      email: "existing@korva.test",
      createdNewUser: false,
    });
    renderWithProviders(<AcceptInvitationPage />);
    await submit();

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/invitations/good-token/accept",
        {},
        { withOrganization: false },
      ),
    );
    expect(await screen.findByText(/invitation acceptée/i)).toBeInTheDocument();
  });

  it("sends firstName/lastName/password only when filled in", async () => {
    postMock.mockResolvedValue({
      organizationId: "org1",
      membershipId: "m1",
      roleId: "r1",
      userId: "u1",
      email: "new@korva.test",
      createdNewUser: true,
    });
    renderWithProviders(<AcceptInvitationPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Prénom"), "Jean");
    await user.type(screen.getByLabelText(/mot de passe \(nouveau compte/i), "validpassword1");
    await user.type(screen.getByLabelText("Confirmer le mot de passe"), "validpassword1");
    await user.click(screen.getByRole("button", { name: /rejoindre l'organisation/i }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/invitations/good-token/accept",
        { password: "validpassword1", firstName: "Jean" },
        { withOrganization: false },
      ),
    );
  });

  it("rejects a mismatched password confirmation without calling the API", async () => {
    renderWithProviders(<AcceptInvitationPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/mot de passe \(nouveau compte/i), "validpassword1");
    await user.type(screen.getByLabelText("Confirmer le mot de passe"), "differentpassword1");
    await user.click(screen.getByRole("button", { name: /rejoindre l'organisation/i }));

    await waitFor(() => expect(postMock).not.toHaveBeenCalled());
    expect(await screen.findByText(/ne correspondent pas/i)).toBeInTheDocument();
  });

  it("shows a dedicated hint (not a generic error) on PASSWORD_REQUIRED, so the user can retry with a password", async () => {
    postMock.mockRejectedValue(
      new ApiError("PASSWORD_REQUIRED", "A password is required to create your account"),
    );
    renderWithProviders(<AcceptInvitationPage />);
    await submit();

    expect(
      await screen.findByText(/un mot de passe est requis pour créer votre compte/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/une erreur est survenue/i),
    ).not.toBeInTheDocument();
  });

  it("shows a generic French message for INVALID_INVITATION_TOKEN", async () => {
    postMock.mockRejectedValue(
      new ApiError("INVALID_INVITATION_TOKEN", "This invitation is invalid, expired, or already used"),
    );
    renderWithProviders(<AcceptInvitationPage />);
    await submit();

    expect(
      await screen.findByText(/cette invitation est invalide ou a expiré/i),
    ).toBeInTheDocument();
  });

  it("shows a generic technical error message on a network failure", async () => {
    postMock.mockRejectedValue(new Error("network down"));
    renderWithProviders(<AcceptInvitationPage />);
    await submit();

    expect(await screen.findByText(/une erreur est survenue/i)).toBeInTheDocument();
  });
});
