import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ForgotPasswordPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

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
const SUCCESS_TEXT =
  /si un compte existe avec cette adresse e-mail, un lien de réinitialisation a été envoyé/i;

async function submit(email: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), email);
  await user.click(screen.getByRole("button", { name: /envoyer le lien/i }));
  return user;
}

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    postMock.mockReset();
  });

  it("renders the initial form", () => {
    renderWithProviders(<ForgotPasswordPage />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /envoyer le lien/i })).toBeInTheDocument();
  });

  it("rejects an invalid email locally and never calls the API", async () => {
    renderWithProviders(<ForgotPasswordPage />);
    await submit("not-an-email");

    await waitFor(() => expect(postMock).not.toHaveBeenCalled());
    await waitFor(() => {
      const errorParagraph = screen
        .getByLabelText("Email")
        .parentElement?.querySelector("p.text-destructive");
      expect(errorParagraph).toBeInTheDocument();
    });
  });

  it("submits a valid email and calls POST /auth/forgot-password with exactly { email }", async () => {
    postMock.mockResolvedValue({ message: "irrelevant" });
    renderWithProviders(<ForgotPasswordPage />);
    await submit("ada@example.com");

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/auth/forgot-password",
        { email: "ada@example.com" },
        { withOrganization: false },
      ),
    );
  });

  it("shows a loading state while the request is pending", async () => {
    postMock.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<ForgotPasswordPage />);
    await submit("ada@example.com");

    expect(await screen.findByRole("button", { name: /envoi/i })).toBeDisabled();
  });

  it("shows the same generic success message no matter what the backend returns — never revealing whether the account exists", async () => {
    for (const backendMessage of [
      "If an account exists for this email, a reset link has been sent.",
      "some completely different string the backend could return",
    ]) {
      postMock.mockReset();
      postMock.mockResolvedValue({ message: backendMessage });
      const { unmount } = renderWithProviders(<ForgotPasswordPage />);
      await submit("ada@example.com");

      expect(await screen.findByText(SUCCESS_TEXT)).toBeInTheDocument();
      // The UI's own generic copy is shown — the backend's literal message text is never
      // rendered, so nothing account-existence-specific could leak through it either.
      expect(screen.queryByText(backendMessage)).not.toBeInTheDocument();

      unmount();
    }
  });

  it("shows a generic technical error message on failure, never a raw backend/network detail", async () => {
    postMock.mockRejectedValue(new Error("network down"));
    renderWithProviders(<ForgotPasswordPage />);
    await submit("ada@example.com");

    expect(await screen.findByText(/une erreur est survenue/i)).toBeInTheDocument();
    expect(screen.queryByText(/network down/i)).not.toBeInTheDocument();
  });
});
