import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ContactsPage from "./page";
import { renderWithProviders } from "@/test/render";
import { apiClient } from "@/lib/api-client";

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, get: vi.fn(), post: vi.fn() } };
});

const getMock = vi.mocked(apiClient.get);
const postMock = vi.mocked(apiClient.post);

describe("ContactsPage (migrated to @korva/ui Button/Input/Card in F2-B.7)", () => {
  beforeEach(() => {
    getMock.mockReset();
    postMock.mockReset();
    getMock.mockResolvedValue([]);
  });

  it("renders the search input and the toggle button", async () => {
    renderWithProviders(<ContactsPage />);
    expect(screen.getByPlaceholderText("Rechercher un contact...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nouveau contact" })).toBeInTheDocument();
    await waitFor(() => expect(getMock).toHaveBeenCalled());
  });

  it("toggles the create form open and closed via the same button", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);

    expect(screen.queryByPlaceholderText("Prénom")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nouveau contact" }));
    expect(screen.getByPlaceholderText("Prénom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Annuler" }));
    expect(screen.queryByPlaceholderText("Prénom")).not.toBeInTheDocument();
  });

  it("filters via the search input (queryFn receives the typed value)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);
    await waitFor(() => expect(getMock).toHaveBeenCalledWith("/contacts?"));

    await user.type(screen.getByPlaceholderText("Rechercher un contact..."), "ada");
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith("/contacts?search=ada"),
    );
  });

  it("submits the create form and calls POST /contacts with exactly the typed fields", async () => {
    postMock.mockResolvedValue({
      id: "1",
      type: "person",
      tags: [],
    });
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);

    await user.click(screen.getByRole("button", { name: "Nouveau contact" }));
    await user.type(screen.getByPlaceholderText("Prénom"), "Ada");
    await user.type(screen.getByPlaceholderText("Nom"), "Lovelace");
    await user.type(screen.getByPlaceholderText("Email"), "ada@example.com");
    await user.type(screen.getByPlaceholderText("Téléphone"), "0102030405");
    await user.type(screen.getByPlaceholderText("Entreprise"), "Analytical Engines");
    await user.click(screen.getByRole("button", { name: "Créer le contact" }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith("/contacts", {
        type: "person",
        tags: [],
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        phone: "0102030405",
        company: "Analytical Engines",
      }),
    );
  });

  it("shows a loading state on the submit button while the request is pending", async () => {
    postMock.mockImplementation(() => new Promise(() => {}));
    const user = userEvent.setup();
    renderWithProviders(<ContactsPage />);

    // All fields filled, not just email: createContactSchema's optional string fields use
    // .min(1), which rejects react-hook-form's default "" for an untouched field — a
    // pre-existing trait of this page unrelated to the migration (same category as the
    // register.tsx native-validation quirk found in F2-B.4). Leaving a field empty here would
    // make zodResolver reject the submission silently (no error UI exists for these fields
    // beyond email), so mutate() would never be called and this test would falsely fail.
    await user.click(screen.getByRole("button", { name: "Nouveau contact" }));
    await user.type(screen.getByPlaceholderText("Prénom"), "Ada");
    await user.type(screen.getByPlaceholderText("Nom"), "Lovelace");
    await user.type(screen.getByPlaceholderText("Email"), "ada@example.com");
    await user.type(screen.getByPlaceholderText("Téléphone"), "0102030405");
    await user.type(screen.getByPlaceholderText("Entreprise"), "Analytical Engines");
    await user.click(screen.getByRole("button", { name: "Créer le contact" }));

    expect(await screen.findByRole("button", { name: "Création..." })).toBeDisabled();
  });
});
