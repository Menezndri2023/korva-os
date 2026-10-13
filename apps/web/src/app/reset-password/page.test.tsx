import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ResetPasswordPage from "./page";
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

async function fillAndSubmit(password: string, confirmPassword: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Nouveau mot de passe"), password);
  await user.type(screen.getByLabelText("Confirmer le mot de passe"), confirmPassword);
  await user.click(screen.getByRole("button", { name: /réinitialiser le mot de passe/i }));
  return user;
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    postMock.mockReset();
    setToken("good-token");
  });

  it("reads the token from ?token= and shows the form when present", () => {
    setToken("abc123");
    renderWithProviders(<ResetPasswordPage />);
    expect(screen.getByLabelText("Nouveau mot de passe")).toBeInTheDocument();
  });

  it("shows an invalid-link state and makes no API call when the token is absent", () => {
    setToken(null);
    renderWithProviders(<ResetPasswordPage />);

    expect(screen.getByText(/lien invalide/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Nouveau mot de passe")).not.toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than 8 characters", async () => {
    renderWithProviders(<ResetPasswordPage />);
    await fillAndSubmit("short1", "short1");

    await waitFor(() => expect(postMock).not.toHaveBeenCalled());
    await waitFor(() => {
      const errorParagraph = screen
        .getByLabelText("Nouveau mot de passe")
        .parentElement?.querySelector("p.text-destructive");
      expect(errorParagraph).toBeInTheDocument();
    });
  });

  it("rejects a password longer than 72 characters", async () => {
    renderWithProviders(<ResetPasswordPage />);
    const tooLong = "a".repeat(73);
    await fillAndSubmit(tooLong, tooLong);

    await waitFor(() => expect(postMock).not.toHaveBeenCalled());
  });

  it("rejects a mismatched confirmation", async () => {
    renderWithProviders(<ResetPasswordPage />);
    await fillAndSubmit("validpassword1", "differentpassword1");

    await waitFor(() => expect(postMock).not.toHaveBeenCalled());
    expect(await screen.findByText(/ne correspondent pas/i)).toBeInTheDocument();
  });

  it("submits and calls POST /auth/reset-password with exactly { token, password } — confirmPassword is never sent", async () => {
    postMock.mockResolvedValue({ success: true });
    setToken("good-token");
    renderWithProviders(<ResetPasswordPage />);
    await fillAndSubmit("validpassword1", "validpassword1");

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/auth/reset-password",
        { token: "good-token", password: "validpassword1" },
        { withOrganization: false },
      ),
    );
  });

  it("shows a loading state while the request is pending", async () => {
    postMock.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<ResetPasswordPage />);
    await fillAndSubmit("validpassword1", "validpassword1");

    expect(await screen.findByRole("button", { name: /réinitialisation/i })).toBeDisabled();
  });

  it("shows a success state after a successful reset", async () => {
    postMock.mockResolvedValue({ success: true });
    renderWithProviders(<ResetPasswordPage />);
    await fillAndSubmit("validpassword1", "validpassword1");

    expect(await screen.findByText(/mot de passe réinitialisé/i)).toBeInTheDocument();
  });

  it("shows a generic French message for INVALID_RESET_TOKEN, never the raw backend text — and never distinguishes invalid/expired/used", async () => {
    postMock.mockRejectedValue(
      new ApiError("INVALID_RESET_TOKEN", "This reset link is invalid or has expired"),
    );
    renderWithProviders(<ResetPasswordPage />);
    await fillAndSubmit("validpassword1", "validpassword1");

    expect(
      await screen.findByText(/ce lien de réinitialisation est invalide ou a expiré/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("This reset link is invalid or has expired"),
    ).not.toBeInTheDocument();
  });

  it("shows a generic technical error message on a network failure", async () => {
    postMock.mockRejectedValue(new Error("network down"));
    renderWithProviders(<ResetPasswordPage />);
    await fillAndSubmit("validpassword1", "validpassword1");

    expect(await screen.findByText(/une erreur est survenue/i)).toBeInTheDocument();
  });
});
