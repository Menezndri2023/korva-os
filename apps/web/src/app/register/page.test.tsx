import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RegisterPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

const replaceMock = vi.fn();

// The page language follows ?lang=; French unless a test sets it.
const searchParams = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(searchParams),
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

// Same reason as onboarding's F1-A test: setSession() writes through zustand's persist
// middleware to real localStorage, which isn't fully implemented in jsdom and throws — mocking
// the store avoids that unrelated environment issue instead of exercising it.
vi.mock("@/lib/auth-store", () => ({
  useAuthStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setSession: vi.fn() }),
}));

const postMock = vi.mocked(apiClient.post);

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Prénom"), "Ada");
  await user.type(screen.getByLabelText("Nom"), "Lovelace");
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Mot de passe"), "validpassword1");
  await user.click(screen.getByRole("button", { name: /créer mon compte/i }));
  return user;
}

describe("RegisterPage (migrated to @korva/ui Button/Input in F2-B.4)", () => {
  beforeEach(() => {
    postMock.mockReset();
    replaceMock.mockReset();
  });

  it("renders the form fields and submit button", () => {
    renderWithProviders(<RegisterPage />);
    expect(screen.getByLabelText("Prénom")).toBeInTheDocument();
    expect(screen.getByLabelText("Nom")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /créer mon compte/i })).toBeInTheDocument();
  });

  it("submits and calls POST /auth/register with exactly { firstName, lastName, email, password }", async () => {
    postMock.mockResolvedValue({
      user: { id: "1", email: "ada@example.com" },
      accessToken: "token",
    });
    renderWithProviders(<RegisterPage />);
    await fillAndSubmit();

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(
        "/auth/register",
        {
          firstName: "Ada",
          lastName: "Lovelace",
          email: "ada@example.com",
          password: "validpassword1",
        },
        { withOrganization: false },
      ),
    );
  });

  it("navigates to /onboarding on success", async () => {
    postMock.mockResolvedValue({
      user: { id: "1", email: "ada@example.com" },
      accessToken: "token",
    });
    renderWithProviders(<RegisterPage />);
    await fillAndSubmit();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("/onboarding"));
  });

  it("shows a loading state while the request is pending", async () => {
    postMock.mockImplementation(() => new Promise(() => {}));
    renderWithProviders(<RegisterPage />);
    await fillAndSubmit();

    expect(await screen.findByRole("button", { name: /création/i })).toBeDisabled();
  });

  it("shows a generic technical error message on failure", async () => {
    postMock.mockRejectedValue(new Error("network down"));
    renderWithProviders(<RegisterPage />);
    await fillAndSubmit();

    expect(await screen.findByText(/une erreur est survenue/i)).toBeInTheDocument();
  });

  it("shows a field error under Mot de passe for a too-short password, via the same p.text-destructive pattern as the other auth forms", async () => {
    // Uses the password field rather than email: register.tsx's <form> has no `noValidate`
    // (unlike forgot-password/reset-password), so an <input type="email"> value that fails the
    // browser's own constraint validation never reaches RHF/zod at all in a real browser or
    // jsdom — that's a pre-existing trait of this page, unrelated to this migration, and not
    // something to exercise here. type="password" has no such native format constraint.
    renderWithProviders(<RegisterPage />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Prénom"), "Ada");
    await user.type(screen.getByLabelText("Nom"), "Lovelace");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Mot de passe"), "short1");
    await user.click(screen.getByRole("button", { name: /créer mon compte/i }));

    await waitFor(() => expect(postMock).not.toHaveBeenCalled());
    await waitFor(() => {
      const errorParagraph = screen
        .getByLabelText("Mot de passe")
        .parentElement?.querySelector("p.text-destructive");
      expect(errorParagraph).toBeInTheDocument();
    });
  });
});
